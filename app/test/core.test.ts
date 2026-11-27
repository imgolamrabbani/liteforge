import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatCellForDisplay,
  formatSqlLiteral,
} from '../src/core/cellFormatter';
import { exportTableCsv, exportTableJson } from '../src/core/tableExporter';
import { SqliteWasmDatabase, quoteIdent } from '../src/core/wasmEngine';

describe('Core: cellFormatter & tableExporter', () => {
  it('formats NULL, numbers, JSON strings, and BLOB Uint8Arrays cleanly', () => {
    expect(formatCellForDisplay(null)).toEqual({
      kind: 'null',
      display: 'NULL',
      raw: null,
    });
    expect(formatCellForDisplay('{"ok":true}').kind).toBe('json');
    const blob = formatCellForDisplay(new Uint8Array([0xde, 0xad, 0xbe, 0xef]));
    expect(blob.kind).toBe('blob');
    expect(blob.display).toContain('DEADBEEF');
    expect(formatSqlLiteral(new Uint8Array([0x0a, 0xff]))).toBe("X'0AFF'");
    expect(formatSqlLiteral("O'Reilly")).toBe("'O''Reilly'");
    expect(quoteIdent('user"table')).toBe('"user""table"');
  });

  it('exports RFC-4180 CSV and JSON cleanly', () => {
    const csv = exportTableCsv(
      ['id', 'bio', 'raw'],
      [[1, 'hello, "world"', new Uint8Array([0x01, 0x02])]]
    );
    expect(csv).toContain('"hello, ""world""",0x0102');

    const json = JSON.parse(
      exportTableJson(['id', 'name'], [[1, 'Ada'], [2, null]])
    );
    expect(json).toEqual([
      { id: 1, name: 'Ada' },
      { id: 2, name: null },
    ]);
  });
});

describe('Core: SqliteWasmDatabase (real .sqlite WASM round-trip)', () => {
  it('creates, writes, reopens a real .sqlite file, introspects tables/FKs/indexes, paginates, sorts, searches, and runs SQL', async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'liteforge-core-'));
    const dbPath = path.join(tmp, 'sample.sqlite');
    try {
      const mem = await SqliteWasmDatabase.openBytes();
      mem.runSql(`
        CREATE TABLE users (
          id INTEGER PRIMARY KEY,
          email TEXT NOT NULL,
          payload TEXT
        );
        CREATE INDEX idx_users_email ON users(email);
        INSERT INTO users (id, email, payload) VALUES
          (1, 'ada@liteforge.dev', '{"role":"admin"}'),
          (2, 'grace@liteforge.dev', NULL),
          (3, 'linus@liteforge.dev', '{"role":"kernel"}');
      `);
      await fs.writeFile(dbPath, mem.exportBytes());
      mem.close();

      // Reopen from disk via WASM
      const diskDb = await SqliteWasmDatabase.openFile(dbPath);
      try {
        const tables = diskDb.listTables();
        expect(tables).toHaveLength(1);
        expect(tables[0].name).toBe('users');
        expect(tables[0].rowCount).toBe(3);
        expect(tables[0].indexes.map((i) => i.name)).toContain('idx_users_email');

        const page = diskDb.queryPage({
          table: 'users',
          page: 1,
          pageSize: 2,
          sortColumn: 'email',
          sortDir: 'DESC',
        });
        expect(page.totalRows).toBe(3);
        expect(page.rows).toHaveLength(2);
        expect(page.rows[0].values[1]).toBe('linus@liteforge.dev');

        const filtered = diskDb.queryPage({
          table: 'users',
          page: 1,
          pageSize: 10,
          search: 'grace',
        });
        expect(filtered.totalRows).toBe(1);
        expect(filtered.rows[0].values[1]).toBe('grace@liteforge.dev');

        const sqlRes = diskDb.runSql("SELECT COUNT(*) AS cnt FROM users WHERE email LIKE '%liteforge%'");
        expect(sqlRes.error).toBeUndefined();
        expect(sqlRes.rows[0][0]).toBe(3);

        const badSql = diskDb.runSql('SELECT * FROM nonexistent_table_xyz');
        expect(badSql.error).toBeTruthy();
      } finally {
        diskDb.close();
      }
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
  });
});
