import fs from 'node:fs/promises';
import path from 'node:path';
import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js';
import type {
  CellValue,
  ColumnSchema,
  ForeignKeySchema,
  IndexSchema,
  PageQueryOptions,
  PageResult,
  SqlQueryResult,
  TableSchema,
} from './types';

let sqlJsPromise: Promise<SqlJsStatic> | null = null;

export function quoteIdent(identifier: string): string {
  return `"${identifier.replace(/"/g, '""')}"`;
}

async function resolveWasmBinary(customWasmPath?: string): Promise<Uint8Array> {
  const candidates = [
    customWasmPath,
    path.join(__dirname, 'sql-wasm.wasm'),
    path.resolve(__dirname, '../../dist/sql-wasm.wasm'),
    path.resolve(__dirname, '../../node_modules/sql.js/dist/sql-wasm.wasm'),
    path.resolve(process.cwd(), 'dist/sql-wasm.wasm'),
    path.resolve(process.cwd(), 'node_modules/sql.js/dist/sql-wasm.wasm'),
  ].filter((p): p is string => Boolean(p));

  for (const candidate of candidates) {
    try {
      const buf = await fs.readFile(candidate);
      return new Uint8Array(buf);
    } catch {
      // Try next candidate
    }
  }
  throw new Error(
    `Could not locate sql-wasm.wasm in any candidate path: ${candidates.join(', ')}`
  );
}

export async function getSqlJs(customWasmPath?: string): Promise<SqlJsStatic> {
  if (!sqlJsPromise) {
    sqlJsPromise = (async () => {
      const wasmBinary = await resolveWasmBinary(customWasmPath);
      return initSqlJs({ wasmBinary: wasmBinary.buffer as ArrayBuffer });
    })();
  }
  return sqlJsPromise;
}

export class SqliteWasmDatabase {
  private readonly db: Database;
  public readonly filePath?: string;

  private constructor(db: Database, filePath?: string) {
    this.db = db;
    this.filePath = filePath;
  }

  static async openFile(
    filePath: string,
    customWasmPath?: string
  ): Promise<SqliteWasmDatabase> {
    const SQL = await getSqlJs(customWasmPath);
    const bytes = await fs.readFile(filePath);
    return new SqliteWasmDatabase(new SQL.Database(new Uint8Array(bytes)), filePath);
  }

  static async openBytes(
    bytes?: Uint8Array,
    filePath?: string,
    customWasmPath?: string
  ): Promise<SqliteWasmDatabase> {
    const SQL = await getSqlJs(customWasmPath);
    return new SqliteWasmDatabase(new SQL.Database(bytes), filePath);
  }

  getRawDatabase(): Database {
    return this.db;
  }

  exportBytes(): Uint8Array {
    return this.db.export();
  }

  close(): void {
    this.db.close();
  }

  /**
   * Lists all user tables and views using strict single-quoted string literals
   * (immune to SQLite 3.41+ DQS=0 double-quoted literal crashes).
   */
  listTables(): TableSchema[] {
    const masterRes = this.db.exec(
      "SELECT name, type, sql FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    if (masterRes.length === 0) {
      return [];
    }

    const tables: TableSchema[] = [];
    for (const row of masterRes[0].values) {
      const name = String(row[0]);
      const type = String(row[1]) === 'view' ? 'view' : 'table';
      const sql = row[2] ? String(row[2]) : '';

      const columns = this.getTableColumns(name);
      const foreignKeys = type === 'table' ? this.getForeignKeys(name) : [];
      const indexes = type === 'table' ? this.getIndexes(name) : [];
      const rowCount = this.getRowCount(name);

      tables.push({
        name,
        type,
        sql,
        rowCount,
        columns,
        foreignKeys,
        indexes,
      });
    }

    return tables;
  }

  getTableColumns(tableName: string): ColumnSchema[] {
    const res = this.db.exec(`PRAGMA table_info(${quoteIdent(tableName)})`);
    if (res.length === 0) return [];
    return res[0].values.map((r) => ({
      cid: Number(r[0]),
      name: String(r[1]),
      type: String(r[2] ?? ''),
      notNull: Number(r[3]) === 1,
      defaultValue: r[4] === null || r[4] === undefined ? null : String(r[4]),
      primaryKey: Number(r[5] ?? 0),
    }));
  }

  getForeignKeys(tableName: string): ForeignKeySchema[] {
    const res = this.db.exec(`PRAGMA foreign_key_list(${quoteIdent(tableName)})`);
    if (res.length === 0) return [];
    return res[0].values.map((r) => ({
      id: Number(r[0]),
      fromTable: tableName,
      toTable: String(r[2]),
      fromColumn: String(r[3]),
      toColumn: String(r[4]),
      onUpdate: String(r[5] ?? 'NO ACTION'),
      onDelete: String(r[6] ?? 'NO ACTION'),
    }));
  }

  getIndexes(tableName: string): IndexSchema[] {
    const res = this.db.exec(`PRAGMA index_list(${quoteIdent(tableName)})`);
    if (res.length === 0) return [];

    const indexes: IndexSchema[] = [];
    for (const r of res[0].values) {
      const idxName = String(r[1]);
      if (idxName.startsWith('sqlite_autoindex_')) continue;
      const unique = Number(r[2]) === 1;

      const infoRes = this.db.exec(`PRAGMA index_info(${quoteIdent(idxName)})`);
      const columns =
        infoRes.length > 0
          ? infoRes[0].values.map((c) => String(c[2] ?? ''))
          : [];

      const stmt = this.db.prepare(
        "SELECT sql FROM sqlite_master WHERE type = 'index' AND name = ?"
      );
      let sql: string | null = null;
      try {
        stmt.bind([idxName]);
        if (stmt.step()) {
          const val = stmt.get()[0];
          sql = val ? String(val) : null;
        }
      } finally {
        stmt.free();
      }

      indexes.push({
        name: idxName,
        tableName,
        unique,
        columns,
        sql,
      });
    }
    return indexes;
  }

  getRowCount(tableName: string): number {
    try {
      const res = this.db.exec(`SELECT COUNT(*) FROM ${quoteIdent(tableName)}`);
      return res.length > 0 ? Number(res[0].values[0][0]) : 0;
    } catch {
      return 0;
    }
  }

  queryPage(options: PageQueryOptions): PageResult {
    const start = performance.now();
    const page = Math.max(1, Math.floor(options.page || 1));
    const pageSize = Math.min(1000, Math.max(1, Math.floor(options.pageSize || 100)));
    const offset = (page - 1) * pageSize;

    const colSchemas = this.getTableColumns(options.table);
    const colNames = colSchemas.map((c) => c.name);
    const quotedTable = quoteIdent(options.table);

    let whereClause = '';
    const params: Array<string | number> = [];

    if (options.search && options.search.trim().length > 0 && colNames.length > 0) {
      const pattern = `%${options.search.trim()}%`;
      const predicates = colNames.map(
        (c) => `CAST(${quoteIdent(c)} AS TEXT) LIKE ?`
      );
      whereClause = ` WHERE ${predicates.join(' OR ')}`;
      for (let i = 0; i < colNames.length; i++) {
        params.push(pattern);
      }
    }

    // Total count under filter
    const countStmt = this.db.prepare(
      `SELECT COUNT(*) FROM ${quotedTable}${whereClause}`
    );
    let totalRows = 0;
    try {
      if (params.length > 0) countStmt.bind(params);
      if (countStmt.step()) {
        totalRows = Number(countStmt.get()[0]);
      }
    } finally {
      countStmt.free();
    }

    let orderClause = '';
    if (options.sortColumn && colNames.includes(options.sortColumn)) {
      const dir = options.sortDir === 'DESC' ? 'DESC' : 'ASC';
      orderClause = ` ORDER BY ${quoteIdent(options.sortColumn)} ${dir}`;
    }

    // Try selecting rowid alongside columns for editable tables; fall back cleanly for views/WITHOUT ROWID
    let includeRowId = true;
    try {
      this.db.exec(`SELECT rowid FROM ${quotedTable} LIMIT 1`);
    } catch {
      includeRowId = false;
    }

    const selectCols = includeRowId
      ? `rowid AS __lf_rowid__, ${colNames.map(quoteIdent).join(', ')}`
      : colNames.map(quoteIdent).join(', ');

    const dataSql = `SELECT ${selectCols} FROM ${quotedTable}${whereClause}${orderClause} LIMIT ? OFFSET ?`;
    const dataStmt = this.db.prepare(dataSql);
    const rows: Array<{ rowid: number | null; values: CellValue[] }> = [];
    try {
      dataStmt.bind([...params, pageSize, offset]);
      while (dataStmt.step()) {
        const raw = dataStmt.get() as CellValue[];
        if (includeRowId) {
          const rid = raw[0];
          rows.push({
            rowid: typeof rid === 'number' ? rid : null,
            values: raw.slice(1),
          });
        } else {
          rows.push({ rowid: null, values: raw });
        }
      }
    } finally {
      dataStmt.free();
    }

    return {
      table: options.table,
      columns: colNames,
      rows,
      totalRows,
      page,
      pageSize,
      durationMs: Math.round((performance.now() - start) * 100) / 100,
    };
  }

  runSql(sql: string): SqlQueryResult {
    const start = performance.now();
    try {
      const results = this.db.exec(sql);
      const durationMs = Math.round((performance.now() - start) * 100) / 100;
      if (results.length === 0) {
        return {
          columns: [],
          rows: [],
          rowsAffected: this.db.getRowsModified(),
          durationMs,
        };
      }
      const last = results[results.length - 1];
      return {
        columns: last.columns,
        rows: last.values as CellValue[][],
        rowsAffected: this.db.getRowsModified(),
        durationMs,
      };
    } catch (err) {
      return {
        columns: [],
        rows: [],
        rowsAffected: 0,
        durationMs: Math.round((performance.now() - start) * 100) / 100,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  }
}
