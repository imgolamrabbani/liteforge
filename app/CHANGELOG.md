# Changelog

## [1.1.0] - 2026-11-29

### Added
- **CSV / JSON → SQLite Table Importer (Free):**
  - New command **`LiteForge: Import CSV / JSON into SQLite Table`** (`liteforge.importData`) parses RFC-4180 CSV or JSON arrays, infers SQLite column types (`INTEGER`, `REAL`, `TEXT`), quotes identifiers safely against SQL injection, inserts transactionally via WASM `sql.js`, and writes back atomically.

## [1.0.0] - 2026-11-27

### Added
- **Pure WASM SQLite Core (Free Forever):**
  - Bundled `sql.js` + `sql-wasm.wasm` — zero native binaries, zero `libtinfo.so.5` or `chmod` errors, SQLite 3.41+ single-quoted introspection.
  - Custom Editor for `*.db`, `*.sqlite`, `*.sqlite3`, `*.db3`, `*.s3db` plus Activity Bar database explorer.
  - Paginated Data Grid with sorting, search, `NULL`/BLOB hex/JSON inspector, SQL Query Runner, and RFC-4180 CSV/JSON export.
- **Pro Database Engineering Suite:**
  - Transactional inline cell/row editor with SQL diff preview and atomic `.liteforge.tmp` -> `fs.rename` write-back.
  - Visual Schema & Foreign-Key ERD Relationship Inspector.
  - Local 2-file SQLite Schema Diff & Migration SQL Generator.
  - Full transactional `.sql` schema+data dump (with `X'...'` BLOB literals) and multi-table JSON export.
  - Polar.sh offline-resilient licensing (72h cache + 14-day offline grace).
