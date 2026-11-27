import { bytesToHex, formatSqlLiteral } from '../core/cellFormatter';
import type { CellValue } from '../core/types';
import { quoteIdent, type SqliteWasmDatabase } from '../core/wasmEngine';

export function dumpDatabaseToSql(engine: SqliteWasmDatabase): string {
  const tables = engine.listTables();
  const db = engine.getRawDatabase();
  const lines: string[] = [
    '-- LiteForge SQLite Full Dump',
    `-- Generated: ${new Date().toISOString()}`,
    'PRAGMA foreign_keys=OFF;',
    'BEGIN TRANSACTION;',
    '',
  ];

  // Tables + data
  for (const tbl of tables.filter((t) => t.type === 'table')) {
    if (tbl.sql) {
      lines.push(tbl.sql.trim().endsWith(';') ? tbl.sql.trim() : `${tbl.sql.trim()};`);
    }

    const colNames = tbl.columns.map((c) => c.name);
    if (colNames.length > 0) {
      const quotedCols = colNames.map(quoteIdent).join(', ');
      const res = db.exec(
        `SELECT ${quotedCols} FROM ${quoteIdent(tbl.name)}`
      );
      if (res.length > 0) {
        for (const row of res[0].values as CellValue[][]) {
          const vals = row.map((v) => formatSqlLiteral(v)).join(', ');
          lines.push(
            `INSERT INTO ${quoteIdent(tbl.name)} (${quotedCols}) VALUES (${vals});`
          );
        }
      }
    }
    lines.push('');
  }

  // Indexes
  for (const tbl of tables.filter((t) => t.type === 'table')) {
    for (const idx of tbl.indexes) {
      if (idx.sql) {
        lines.push(idx.sql.trim().endsWith(';') ? idx.sql.trim() : `${idx.sql.trim()};`);
      }
    }
  }

  // Views
  for (const view of tables.filter((t) => t.type === 'view')) {
    if (view.sql) {
      lines.push(view.sql.trim().endsWith(';') ? view.sql.trim() : `${view.sql.trim()};`);
    }
  }

  lines.push('', 'COMMIT;', '');
  return lines.join('\n');
}

export function dumpDatabaseToMultiTableJson(
  engine: SqliteWasmDatabase
): string {
  const tables = engine.listTables().filter((t) => t.type === 'table');
  const db = engine.getRawDatabase();
  const payload: Record<string, Array<Record<string, string | number | null>>> = {};

  for (const tbl of tables) {
    const colNames = tbl.columns.map((c) => c.name);
    const rowsOut: Array<Record<string, string | number | null>> = [];
    if (colNames.length > 0) {
      const res = db.exec(
        `SELECT ${colNames.map(quoteIdent).join(', ')} FROM ${quoteIdent(tbl.name)}`
      );
      if (res.length > 0) {
        for (const row of res[0].values as CellValue[][]) {
          const obj: Record<string, string | number | null> = {};
          colNames.forEach((col, i) => {
            const val = row[i];
            obj[col] =
              val instanceof Uint8Array
                ? `0x${bytesToHex(val, val.byteLength)}`
                : (val ?? null);
          });
          rowsOut.push(obj);
        }
      }
    }
    payload[tbl.name] = rowsOut;
  }

  return (
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        tables: payload,
      },
      null,
      2
    ) + '\n'
  );
}
