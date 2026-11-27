---
title: "Why vscode-sqlite Breaks on SQLite 3.41+ & Remote-SSH (And How We Built a Zero-Binary WASM SQLite Studio)"
published: true
tags: vscode, sqlite, webassembly, typescript
---

If you have used `alexcvzz.vscode-sqlite` (4.8M+ installs, unmaintained since 2022) on a recent Linux distro, Remote-SSH host, or modern SQLite build, you have likely hit one of two walls:

1. `Error: no such column: table` when opening any database.
2. `error while loading shared libraries: libtinfo.so.5` (or `EACCES` / `chmod` errors) when the extension tries to execute its bundled native `sqlite3` binary.

Rather than wrapping another native binary or requiring external drivers, we built **[LiteForge](https://imgolamrabbani.github.io/liteforge/)**: a zero-dependency WebAssembly SQLite studio (`sql.js`) for VS Code and Open VSX that runs identically on macOS, Windows, Linux, Remote-SSH, WSL, and DevContainers. Here is why legacy extensions break and how LiteForge's architecture avoids those failure modes.

---

## 1. Why Legacy SQLite Extensions Break: `DQS=0` and `libtinfo.so.5`

### The SQLite 3.41+ Double-Quoted Literal Trap
Historically, SQLite allowed double-quoted strings (`"table"`) to fall back to string literals if no matching column existed. Starting with **SQLite 3.41+**, distributions and builds increasingly compile with `-DSQLITE_DQS=0` (disabling double-quoted string literals in DML/DDL).

Legacy extensions that introspect `sqlite_master` using queries like:
```sql
SELECT name FROM sqlite_master WHERE type = "table";
```
immediately crash with `no such column: table` because SQLite now strictly treats `"table"` as an identifier.

### The Bundled Native Binary Trap on Remote-SSH & Linux
Shipping prebuilt `sqlite3` CLI binaries inside a `.vsix` is equally brittle:
- **Shared library drift:** Older prebuilt binaries linked against `libtinfo.so.5` fail to start on Ubuntu 24.04, Debian 12+, Fedora, or minimal Docker DevContainers that only ship `libtinfo.so.6`.
- **Permission & architecture mismatches:** Remote-SSH and WSL hosts often have different CPU architectures (`arm64` vs `x64`) or stripped execute bits when `.vsix` archives are unpacked.

---

## 2. Zero-Binary `sql.js` WASM Loading & Safe Querying

In `wasmEngine.ts`, LiteForge eliminates native binaries completely by running SQLite compiled to WebAssembly (`sql.js`) inside the VS Code Extension Host:

- **Deterministic WASM bundling:** `esbuild.config.mjs` copies `node_modules/sql.js/dist/sql-wasm.wasm` directly into `dist/sql-wasm.wasm` on every build. At runtime, `wasmEngine.ts` reads the `.wasm` bytes via `node:fs/promises` and initializes `initSqlJs({ wasmBinary })` with zero network calls and zero C++ addons.
- **Strict SQL quoting (`DQS=0` immune):** Every internal introspection query uses strict single-quoted string literals:
  ```sql
  SELECT name, type, sql
  FROM sqlite_master
  WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'
  ORDER BY name;
  ```
- **Identifier & parameter isolation:** Dynamic table and column names are escaped with `quoteIdent(id)` (`'"' + id.replace(/"/g, '""') + '"'`), while every cell filter and edit value is bound via `?` positional parameters.

Because it's pure WASM + Node.js 20+ built-ins, a `.sqlite` file behaves identically whether it sits on your local MacBook or inside an Alpine Linux DevContainer over Remote-SSH.

---

## 3. Transactional SQL Diff Preview & Atomic Temp-File Write-Back

Editing a local `.sqlite` file in a GUI can be nerve-wracking if writes happen blindly on every cell blur. In `inlineEditor.ts` (Pro), LiteForge uses a **staged edit queue** paired with **atomic file replacement**:

1. **Staged Edits (`StagedEdit[]`):** Cell updates, row inserts, and row deletions accumulate in memory without mutating the database.
2. **SQL Diff Preview (`EditPreviewResult`):** Clicking **Preview & Apply** renders the exact SQL statements (`UPDATE`, `INSERT`, `DELETE`) for review before anything runs.
3. **Transactional Execution:** Statements execute inside `BEGIN TRANSACTION; ...; COMMIT;`. If any `CHECK`, `NOT NULL`, or `FOREIGN KEY` constraint fails, `ROLLBACK;` runs immediately so the in-memory WASM database remains uncorrupted.
4. **Atomic Write-Back:** `db.export()` serializes the updated `Uint8Array`, writes it to `<dbPath>.liteforge.tmp`, and atomically swaps it over `<dbPath>` via `fs.rename()`. A sudden crash or power loss mid-write never leaves a half-written, corrupted `.sqlite` file on disk.

---

## 4. Local 2-File SQLite Schema Diffing & `PRAGMA` ERD Introspection

When developing locally, comparing `dev.sqlite` against `prod-snapshot.sqlite` usually means dumping both schemas and squinting at `diff`.

- **Schema & ERD Introspection (`schemaErd.ts`):** LiteForge queries `PRAGMA table_info`, `PRAGMA foreign_key_list`, and `PRAGMA index_list` across every user table to construct an `ErdGraph` (tables, PKs, FKs, and indexes) rendered with native `--vscode-*` CSS tokens and a strict nonce CSP—zero external CDNs.
- **Deterministic 2-File Schema Diff (`dbDiff.ts`):** Comparing two `.sqlite` files inspects both schema models and emits classified `SchemaDiffItem`s (`table_added`, `table_removed`, `column_added`, `column_removed`, `column_type_changed`, `index_added`, `index_removed`), flagging destructive changes and generating a deterministic `fullMigrationSql` script (`CREATE TABLE`, `ALTER TABLE`, `CREATE INDEX`, `DROP INDEX`).

---

## 5. Free vs. Pro Split (Zero Login, Zero Telemetry)

LiteForge keeps all everyday browsing, querying, and single-table exports **Free Forever** with zero login and zero telemetry:

- **Free ($0 Forever):** Pure WASM `sql.js` custom editor for `.db` / `.sqlite` / `.sqlite3`, paginated data grid with sorting/search and `NULL` / BLOB hex / JSON cell inspector, multi-tab SQL Query Runner, single-table RFC-4180 CSV & JSON export, and native VS Code Light/Dark/High-Contrast theming.
- **Pro ($19 Early Bird one-time / $5/mo):** Transactional inline cell & row editor with SQL diff preview and atomic write-back, visual Schema & Foreign-Key ERD inspector, local 2-file SQLite schema diff & migration SQL generator, and full transactional `.sql` schema + data dump.

Pro licensing uses Polar.sh (`api.polar.sh`) with OS-keychain `SecretStorage`, a 72-hour local cache, and a **14-day offline grace window**—zero background phone-home in Free, and zero offline lockouts in Pro.

---

## Try LiteForge

- **GitHub Repository:** [github.com/imgolamrabbani/liteforge](https://github.com/imgolamrabbani/liteforge)
- **Direct VSIX (`v1.0.0`) for VS Code, Cursor, Windsurf & VSCodium:** [GitHub Release v1.0.0](https://github.com/imgolamrabbani/liteforge/releases/tag/v1.0.0) (`code --install-extension liteforge-1.0.0.vsix`)
- **Website & Docs:** [imgolamrabbani.github.io/liteforge](https://imgolamrabbani.github.io/liteforge/)
- **Optional Pro License:** [$19 Early Bird One-Time (Lifetime v1.x)](https://buy.polar.sh/polar_cl_evSGX7ncQzq8ajjg2Jecr1Mwm8IHGVYwW7mNC3QEvGc) or [$5/month](https://buy.polar.sh/polar_cl_ha0WLRlS412XLUtGag6MWwNYD6sLSgVncLqmM2CnVAo)

If you hit an edge case with `WITHOUT ROWID` tables, strict tables, or custom `PRAGMA` schemas, open an issue on GitHub—we're actively shipping v1.x updates.
