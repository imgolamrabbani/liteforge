import fs from 'node:fs/promises';
import { quoteIdent, type SqliteWasmDatabase } from './wasmEngine';

export type InferredSqlType = 'INTEGER' | 'REAL' | 'TEXT';

export interface ParsedTabularData {
  columns: string[];
  rows: Array<Array<string | number | null>>;
}

export interface DataImportResult {
  tableName: string;
  columnCount: number;
  rowCount: number;
  inferredTypes: Record<string, InferredSqlType>;
}

/**
 * Strict RFC-4180 CSV parser supporting quoted fields, escaped `""`, and embedded newlines.
 */
export function parseRfc4180Csv(csvText: string): ParsedTabularData {
  const input = csvText.replace(/^\uFEFF/, '');
  if (input.trim().length === 0) {
    throw new Error('CSV input is empty.');
  }

  const records: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i];

    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }

    if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else if (ch === '\n') {
      row.push(field);
      records.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }

  if (inQuotes) {
    throw new Error('Malformed CSV: unterminated quoted field.');
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    records.push(row);
  }

  const nonEmpty = records.filter(
    (r) => !(r.length === 1 && r[0].trim() === '')
  );
  if (nonEmpty.length === 0) {
    throw new Error('CSV input contains no rows.');
  }

  const rawHeader = nonEmpty[0];
  const seenNames = new Map<string, number>();
  const columns = rawHeader.map((col, idx) => {
    const base = col.trim() || `column_${idx + 1}`;
    const count = seenNames.get(base) ?? 0;
    seenNames.set(base, count + 1);
    return count === 0 ? base : `${base}_${count + 1}`;
  });

  const rows: Array<Array<string | number | null>> = nonEmpty
    .slice(1)
    .map((r) =>
      columns.map((_, idx) => {
        const val = r[idx];
        if (val === undefined || val === '') return null;
        return val;
      })
    );

  return { columns, rows };
}

/**
 * Parses a JSON array of objects into tabular columns and rows.
 */
export function parseJsonArray(jsonText: string): ParsedTabularData {
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch (err) {
    throw new Error(
      `Invalid JSON: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error('JSON input must be a non-empty array of objects.');
  }

  const columnSet = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new Error('Each item in the JSON array must be a plain object.');
    }
    for (const key of Object.keys(item as Record<string, unknown>)) {
      columnSet.add(key);
    }
  }

  const columns = Array.from(columnSet);
  if (columns.length === 0) {
    throw new Error('JSON objects contain no keys to import.');
  }

  const rows: Array<Array<string | number | null>> = parsed.map((item) => {
    const rec = item as Record<string, unknown>;
    return columns.map((col) => {
      const val = rec[col];
      if (val === undefined || val === null) return null;
      if (typeof val === 'number') return Number.isFinite(val) ? val : null;
      if (typeof val === 'boolean') return val ? 1 : 0;
      if (typeof val === 'object') return JSON.stringify(val);
      return String(val);
    });
  });

  return { columns, rows };
}

export function inferColumnTypes(
  columns: string[],
  rows: Array<Array<string | number | null>>
): Record<string, InferredSqlType> {
  const result: Record<string, InferredSqlType> = {};

  columns.forEach((col, colIdx) => {
    let sawNonNull = false;
    let allInt = true;
    let allReal = true;

    for (const row of rows) {
      const val = row[colIdx];
      if (val === null || val === undefined || val === '') continue;
      sawNonNull = true;

      if (typeof val === 'number') {
        if (!Number.isInteger(val)) allInt = false;
      } else {
        const trimmed = val.trim();
        if (/^-?\d+$/.test(trimmed)) {
          // Valid integer
        } else if (/^-?\d+(\.\d+)?([eE][+-]?\d+)?$/.test(trimmed)) {
          allInt = false;
        } else {
          allInt = false;
          allReal = false;
          break;
        }
      }
    }

    if (!sawNonNull) {
      result[col] = 'TEXT';
    } else if (allInt) {
      result[col] = 'INTEGER';
    } else if (allReal) {
      result[col] = 'REAL';
    } else {
      result[col] = 'TEXT';
    }
  });

  return result;
}

function coerceCellForType(
  val: string | number | null,
  sqlType: InferredSqlType
): string | number | null {
  if (val === null || val === undefined) return null;
  if (sqlType === 'INTEGER') {
    return typeof val === 'number' ? Math.trunc(val) : parseInt(val.trim(), 10);
  }
  if (sqlType === 'REAL') {
    return typeof val === 'number' ? val : parseFloat(val.trim());
  }
  return String(val);
}

export async function importTabularIntoSqlite(
  engine: SqliteWasmDatabase,
  tableName: string,
  data: ParsedTabularData,
  targetFilePath?: string
): Promise<DataImportResult> {
  const cleanTable = tableName.trim();
  if (!cleanTable) {
    throw new Error('Table name cannot be empty.');
  }
  if (data.columns.length === 0) {
    throw new Error('No columns available to import.');
  }

  const inferredTypes = inferColumnTypes(data.columns, data.rows);
  const colDefs = data.columns
    .map((c) => `${quoteIdent(c)} ${inferredTypes[c]}`)
    .join(', ');
  const quotedTable = quoteIdent(cleanTable);
  const quotedCols = data.columns.map(quoteIdent).join(', ');
  const placeholders = data.columns.map(() => '?').join(', ');

  const db = engine.getRawDatabase();
  db.run('BEGIN TRANSACTION;');
  try {
    db.run(`CREATE TABLE IF NOT EXISTS ${quotedTable} (${colDefs});`);
    const stmt = db.prepare(
      `INSERT INTO ${quotedTable} (${quotedCols}) VALUES (${placeholders})`
    );
    try {
      for (const row of data.rows) {
        const bound = data.columns.map((col, idx) =>
          coerceCellForType(row[idx] ?? null, inferredTypes[col])
        );
        stmt.run(bound);
      }
    } finally {
      stmt.free();
    }
    db.run('COMMIT;');
  } catch (err) {
    try {
      db.run('ROLLBACK;');
    } catch {
      // Already rolled back
    }
    throw err;
  }

  const outPath = targetFilePath ?? engine.filePath;
  if (outPath) {
    const bytes = engine.exportBytes();
    const tmpPath = `${outPath}.liteforge.tmp`;
    await fs.writeFile(tmpPath, bytes);
    await fs.rename(tmpPath, outPath);
  }

  return {
    tableName: cleanTable,
    columnCount: data.columns.length,
    rowCount: data.rows.length,
    inferredTypes,
  };
}

export async function importCsvIntoSqlite(
  engine: SqliteWasmDatabase,
  tableName: string,
  csvText: string,
  targetFilePath?: string
): Promise<DataImportResult> {
  const data = parseRfc4180Csv(csvText);
  return importTabularIntoSqlite(engine, tableName, data, targetFilePath);
}

export async function importJsonIntoSqlite(
  engine: SqliteWasmDatabase,
  tableName: string,
  jsonText: string,
  targetFilePath?: string
): Promise<DataImportResult> {
  const data = parseJsonArray(jsonText);
  return importTabularIntoSqlite(engine, tableName, data, targetFilePath);
}
