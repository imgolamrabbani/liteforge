import fs from 'node:fs/promises';
import { formatSqlLiteral } from '../core/cellFormatter';
import type {
  EditPreviewResult,
  StagedEdit,
} from '../core/types';
import { quoteIdent, type SqliteWasmDatabase } from '../core/wasmEngine';

export function previewStagedEdits(edits: StagedEdit[]): EditPreviewResult {
  const statements: string[] = [];

  for (const edit of edits) {
    const tbl = quoteIdent(edit.table);
    if (edit.kind === 'update') {
      if (!edit.column || edit.rowid === undefined) {
        throw new Error('Update edit requires column and rowid.');
      }
      statements.push(
        `UPDATE ${tbl} SET ${quoteIdent(edit.column)} = ${formatSqlLiteral(edit.newValue ?? null)} WHERE rowid = ${edit.rowid};`
      );
    } else if (edit.kind === 'insert') {
      const entries = Object.entries(edit.rowValues ?? {});
      if (entries.length === 0) {
        statements.push(`INSERT INTO ${tbl} DEFAULT VALUES;`);
      } else {
        const cols = entries.map(([k]) => quoteIdent(k)).join(', ');
        const vals = entries.map(([, v]) => formatSqlLiteral(v)).join(', ');
        statements.push(`INSERT INTO ${tbl} (${cols}) VALUES (${vals});`);
      }
    } else if (edit.kind === 'delete') {
      if (edit.rowid === undefined) {
        throw new Error('Delete edit requires rowid.');
      }
      statements.push(`DELETE FROM ${tbl} WHERE rowid = ${edit.rowid};`);
    }
  }

  return {
    statements,
    affectedRows: edits.length,
  };
}

/**
 * Applies staged edits transactionally inside `BEGIN TRANSACTION ... COMMIT`
 * (rolling back cleanly on any SQLite constraint error) and atomically writes
 * the exported database bytes back to disk via `<filePath>.liteforge.tmp` + `fs.rename`.
 */
export async function applyStagedEditsAtomic(
  engine: SqliteWasmDatabase,
  edits: StagedEdit[],
  targetFilePath?: string
): Promise<{ appliedCount: number; preview: EditPreviewResult }> {
  const preview = previewStagedEdits(edits);
  if (edits.length === 0) {
    return { appliedCount: 0, preview };
  }

  const db = engine.getRawDatabase();
  db.run('BEGIN TRANSACTION;');
  try {
    for (const edit of edits) {
      const tbl = quoteIdent(edit.table);
      if (edit.kind === 'update') {
        if (!edit.column || edit.rowid === undefined) {
          throw new Error('Update edit requires column and rowid.');
        }
        db.run(
          `UPDATE ${tbl} SET ${quoteIdent(edit.column)} = ? WHERE rowid = ?`,
          [edit.newValue ?? null, edit.rowid]
        );
      } else if (edit.kind === 'insert') {
        const entries = Object.entries(edit.rowValues ?? {});
        if (entries.length === 0) {
          db.run(`INSERT INTO ${tbl} DEFAULT VALUES`);
        } else {
          const cols = entries.map(([k]) => quoteIdent(k)).join(', ');
          const placeholders = entries.map(() => '?').join(', ');
          const values = entries.map(([, v]) => v ?? null);
          db.run(
            `INSERT INTO ${tbl} (${cols}) VALUES (${placeholders})`,
            values
          );
        }
      } else if (edit.kind === 'delete') {
        if (edit.rowid === undefined) {
          throw new Error('Delete edit requires rowid.');
        }
        db.run(`DELETE FROM ${tbl} WHERE rowid = ?`, [edit.rowid]);
      }
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

  return { appliedCount: edits.length, preview };
}
