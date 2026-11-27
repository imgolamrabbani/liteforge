import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SqliteWasmDatabase } from '../src/core/wasmEngine';
import { diffSqliteFiles } from '../src/pro/dbDiff';
import {
  applyStagedEditsAtomic,
  previewStagedEdits,
} from '../src/pro/inlineEditor';
import { extractErdFromDatabase } from '../src/pro/schemaErd';
import {
  dumpDatabaseToMultiTableJson,
  dumpDatabaseToSql,
} from '../src/pro/sqlDumper';

describe('Pro: inlineEditor (transactional SQL preview + atomic write-back + rollback)', () => {
  it('previews SQL, applies update/insert/delete atomically to disk, and rolls back on constraint errors', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'liteforge-edit-'));
    const dbPath = path.join(tmp, 'edit.sqlite');
    try {
      const init = await SqliteWasmDatabase.openBytes();
      init.runSql(`
        CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        INSERT INTO items (id, name) VALUES (1, 'Alpha'), (2, 'Beta');
      `);
      await fs.writeFile(dbPath, init.exportBytes());
      init.close();

      const db = await SqliteWasmDatabase.openFile(dbPath);
      try {
        const edits = [
          {
            kind: 'update' as const,
            table: 'items',
            rowid: 1,
            column: 'name',
            oldValue: 'Alpha',
            newValue: 'Alpha Updated',
          },
          {
            kind: 'insert' as const,
            table: 'items',
            rowValues: { id: 3, name: 'Gamma' },
          },
          {
            kind: 'delete' as const,
            table: 'items',
            rowid: 2,
          },
        ];

        const preview = previewStagedEdits(edits);
        expect(preview.statements).toHaveLength(3);
        expect(preview.statements[0]).toContain("SET \"name\" = 'Alpha Updated'");

        const applied = await applyStagedEditsAtomic(db, edits, dbPath);
        expect(applied.appliedCount).toBe(3);

        // Verify rollback on NOT NULL violation leaves existing rows intact
        await expect(
          applyStagedEditsAtomic(
            db,
            [
              {
                kind: 'update',
                table: 'items',
                rowid: 1,
                column: 'name',
                newValue: null,
              },
            ],
            dbPath
          )
        ).rejects.toThrow();
      } finally {
        db.close();
      }

      // Reopen from disk to confirm atomic persistence
      const reopened = await SqliteWasmDatabase.openFile(dbPath);
      try {
        const res = reopened.runSql('SELECT id, name FROM items ORDER BY id');
        expect(res.rows).toEqual([
          [1, 'Alpha Updated'],
          [3, 'Gamma'],
        ]);
      } finally {
        reopened.close();
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});

describe('Pro: schemaErd, dbDiff & sqlDumper', () => {
  it('extracts FK ERD graph, diffs two .sqlite files into migration SQL, and dumps full .sql + JSON', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'liteforge-pro-'));
    const v1Path = path.join(tmp, 'v1.sqlite');
    const v2Path = path.join(tmp, 'v2.sqlite');
    try {
      const db1 = await SqliteWasmDatabase.openBytes();
      db1.runSql(`
        CREATE TABLE orgs (id INTEGER PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          org_id INTEGER NOT NULL REFERENCES orgs(id),
          email TEXT NOT NULL,
          avatar BLOB
        );
        INSERT INTO orgs VALUES (1, 'Acme');
        INSERT INTO users VALUES (10, 1, 'dev@acme.io', X'CAFEBABE');
      `);
      await fs.writeFile(v1Path, db1.exportBytes());

      // ERD check
      const erd = extractErdFromDatabase(db1);
      expect(erd.tables).toHaveLength(2);
      expect(erd.edges).toHaveLength(1);
      expect(erd.edges[0]).toMatchObject({
        fromTable: 'users',
        fromColumn: 'org_id',
        toTable: 'orgs',
        toColumn: 'id',
      });

      // Dump check (SQL with BLOB hex literal + multi-table JSON)
      const sqlDump = dumpDatabaseToSql(db1);
      expect(sqlDump).toContain('BEGIN TRANSACTION;');
      expect(sqlDump).toContain("X'CAFEBABE'");
      expect(sqlDump).toContain('COMMIT;');

      const jsonDump = JSON.parse(dumpDatabaseToMultiTableJson(db1));
      expect(jsonDump.tables.orgs).toHaveLength(1);
      expect(jsonDump.tables.users[0].avatar).toBe('0xCAFEBABE');
      db1.close();

      // Create v2 with added table, added column, and added index
      const db2 = await SqliteWasmDatabase.openBytes();
      db2.runSql(`
        CREATE TABLE orgs (id INTEGER PRIMARY KEY, name TEXT NOT NULL, plan TEXT DEFAULT 'free');
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          org_id INTEGER NOT NULL REFERENCES orgs(id),
          email TEXT NOT NULL
        );
        CREATE TABLE audit_logs (id INTEGER PRIMARY KEY, action TEXT NOT NULL);
        CREATE INDEX idx_users_email ON users(email);
      `);
      await fs.writeFile(v2Path, db2.exportBytes());
      db2.close();

      const diff = await diffSqliteFiles(v1Path, v2Path);
      expect(diff.differences.some((d) => d.kind === 'table_added' && d.table === 'audit_logs')).toBe(true);
      expect(diff.differences.some((d) => d.kind === 'column_added' && d.table === 'orgs')).toBe(true);
      expect(diff.differences.some((d) => d.kind === 'column_removed' && d.table === 'users' && d.destructive)).toBe(true);
      expect(diff.differences.some((d) => d.kind === 'index_added' && d.table === 'users')).toBe(true);
      expect(diff.fullMigrationSql).toContain('ALTER TABLE "orgs" ADD COLUMN "plan"');
      expect(diff.fullMigrationSql).toContain('CREATE TABLE audit_logs');
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
