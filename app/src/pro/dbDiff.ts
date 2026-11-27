import type {
  DbDiffResult,
  SchemaDiffItem,
  TableSchema,
} from '../core/types';
import { quoteIdent, SqliteWasmDatabase } from '../core/wasmEngine';

export function diffTableSchemas(
  sourceTables: TableSchema[],
  targetTables: TableSchema[],
  sourcePath = 'source.sqlite',
  targetPath = 'target.sqlite'
): DbDiffResult {
  const srcMap = new Map(
    sourceTables.filter((t) => t.type === 'table').map((t) => [t.name, t])
  );
  const tgtMap = new Map(
    targetTables.filter((t) => t.type === 'table').map((t) => [t.name, t])
  );

  const differences: SchemaDiffItem[] = [];

  // Added tables
  for (const [name, tgt] of tgtMap.entries()) {
    if (!srcMap.has(name)) {
      const sql = tgt.sql.trim().endsWith(';') ? tgt.sql.trim() : `${tgt.sql.trim()};`;
      differences.push({
        kind: 'table_added',
        table: name,
        detail: `Table "${name}" added (${tgt.columns.length} columns)`,
        migrationSql: sql,
        destructive: false,
      });
      for (const idx of tgt.indexes) {
        if (idx.sql) {
          differences.push({
            kind: 'index_added',
            table: name,
            detail: `Index "${idx.name}" added on "${name}"`,
            migrationSql: idx.sql.trim().endsWith(';')
              ? idx.sql.trim()
              : `${idx.sql.trim()};`,
            destructive: false,
          });
        }
      }
    }
  }

  // Removed tables
  for (const [name] of srcMap.entries()) {
    if (!tgtMap.has(name)) {
      differences.push({
        kind: 'table_removed',
        table: name,
        detail: `Table "${name}" removed`,
        migrationSql: `-- WARNING: destructive\nDROP TABLE IF EXISTS ${quoteIdent(name)};`,
        destructive: true,
      });
    }
  }

  // Modified tables (columns & indexes)
  for (const [name, src] of srcMap.entries()) {
    const tgt = tgtMap.get(name);
    if (!tgt) continue;

    const srcCols = new Map(src.columns.map((c) => [c.name, c]));
    const tgtCols = new Map(tgt.columns.map((c) => [c.name, c]));

    for (const [colName, col] of tgtCols.entries()) {
      if (!srcCols.has(colName)) {
        const typePart = col.type ? ` ${col.type}` : '';
        const defaultPart =
          col.defaultValue !== null ? ` DEFAULT ${col.defaultValue}` : '';
        const notNullPart =
          col.notNull && col.defaultValue !== null ? ' NOT NULL' : '';
        differences.push({
          kind: 'column_added',
          table: name,
          detail: `Column "${colName}" (${col.type || 'ANY'}) added to "${name}"`,
          migrationSql: `ALTER TABLE ${quoteIdent(name)} ADD COLUMN ${quoteIdent(colName)}${typePart}${notNullPart}${defaultPart};`,
          destructive: false,
        });
      } else {
        const prev = srcCols.get(colName)!;
        if (prev.type.toUpperCase() !== col.type.toUpperCase()) {
          differences.push({
            kind: 'column_type_changed',
            table: name,
            detail: `Column "${name}.${colName}" type changed: ${prev.type || 'ANY'} -> ${col.type || 'ANY'}`,
            migrationSql: `-- WARNING: destructive — SQLite requires table rebuild to alter column type on ${quoteIdent(name)}.${quoteIdent(colName)} (${prev.type} -> ${col.type})`,
            destructive: true,
          });
        }
      }
    }

    for (const [colName] of srcCols.entries()) {
      if (!tgtCols.has(colName)) {
        differences.push({
          kind: 'column_removed',
          table: name,
          detail: `Column "${colName}" removed from "${name}"`,
          migrationSql: `-- WARNING: destructive\nALTER TABLE ${quoteIdent(name)} DROP COLUMN ${quoteIdent(colName)};`,
          destructive: true,
        });
      }
    }

    const srcIdx = new Map(src.indexes.map((i) => [i.name, i]));
    const tgtIdx = new Map(tgt.indexes.map((i) => [i.name, i]));

    for (const [idxName, idx] of tgtIdx.entries()) {
      if (!srcIdx.has(idxName) && idx.sql) {
        differences.push({
          kind: 'index_added',
          table: name,
          detail: `Index "${idxName}" added on "${name}"`,
          migrationSql: idx.sql.trim().endsWith(';')
            ? idx.sql.trim()
            : `${idx.sql.trim()};`,
          destructive: false,
        });
      }
    }

    for (const [idxName] of srcIdx.entries()) {
      if (!tgtIdx.has(idxName)) {
        differences.push({
          kind: 'index_removed',
          table: name,
          detail: `Index "${idxName}" removed from "${name}"`,
          migrationSql: `-- WARNING: destructive\nDROP INDEX IF EXISTS ${quoteIdent(idxName)};`,
          destructive: true,
        });
      }
    }
  }

  const fullMigrationSql =
    differences.length === 0
      ? '-- Schemas are identical. No migration needed.\n'
      : [
          `-- LiteForge Migration Script`,
          `-- Source: ${sourcePath}`,
          `-- Target: ${targetPath}`,
          'BEGIN TRANSACTION;',
          '',
          ...differences.map((d) => d.migrationSql),
          '',
          'COMMIT;',
          '',
        ].join('\n');

  return {
    sourcePath,
    targetPath,
    differences,
    fullMigrationSql,
  };
}

export async function diffSqliteFiles(
  sourcePath: string,
  targetPath: string
): Promise<DbDiffResult> {
  const srcDb = await SqliteWasmDatabase.openFile(sourcePath);
  const tgtDb = await SqliteWasmDatabase.openFile(targetPath);
  try {
    return diffTableSchemas(
      srcDb.listTables(),
      tgtDb.listTables(),
      sourcePath,
      targetPath
    );
  } finally {
    srcDb.close();
    tgtDb.close();
  }
}
