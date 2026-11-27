# LiteForge — Marketplace Listing Copy (`LISTING_COPY.md`)

Ready-to-paste metadata, description, keywords, and privacy disclosures for **Visual Studio Code Marketplace** (publisher `caliberhttp`) and **Open VSX Registry**.

---

## 1. Marketplace Metadata

- **Display Name:** `LiteForge — Zero-Dependency WASM SQLite Studio`
- **Extension ID:** `caliberhttp.liteforge`
- **Short Summary:**
  `Pure WebAssembly SQLite studio for VS Code & Remote-SSH. Browse, query, edit, ERD-inspect & diff .sqlite/.db files with zero native binaries.`
- **Categories:** `Other`, `Data Science`, `Visualization`
- **Keywords:** `sqlite`, `sqlite3`, `sql`, `database`, `wasm`, `erd`, `db diff`, `remote ssh`, `sqlite viewer`
- **Assets Included (`products/liteforge/store-assets/`):**
  - `icon.png` (256×256 PNG — zero SVGs)
  - `banner.png` (1280×640 PNG)
  - `screenshot-1-grid.png` (1280×800 PNG)
  - `screenshot-2-erd-edit.png` (1280×800 PNG)
  - `screenshot-3-diff-dump.png` (1280×800 PNG)

---

## 2. Full Marketplace Description (Markdown)

```markdown
# LiteForge — Zero-Dependency WASM SQLite Studio

**Browse, query, edit, ERD-inspect & diff `.sqlite` / `.db` files locally—with zero native binaries.**

Tired of legacy SQLite extensions crashing on SQLite 3.41+ (`no such column: table`), failing with `libtinfo.so.5` on Linux/Remote-SSH, or paywalling basic editing? **LiteForge** runs 100% on pure WebAssembly (`sql.js`) inside VS Code, Cursor, Windsurf, and VSCodium.

---

## Why Developers Switch to LiteForge

- **100% Pure WebAssembly (`sql.js`):** Zero `sqlite3` CLI executables, zero `libtinfo.so.5` shared-library crashes, zero `chmod` issues on macOS, Windows, Linux, Remote-SSH, WSL, DevContainers, and Codespaces.
- **SQLite 3.41+ Safe:** Uses strict single-quoted schema introspection and parameterized identifier quoting.
- **Zero Login, Zero Telemetry:** Your databases never leave your machine.

---

## Free Forever ($0)

- Custom Editor for `*.db`, `*.sqlite`, `*.sqlite3`, `*.db3`, `*.s3db`
- Paginated Table Data Grid (sorting, search/filter, `NULL` / BLOB hex / pretty JSON inspector)
- Multi-tab SQL Query Runner with execution timing & row counts
- Single-table RFC-4180 CSV & formatted JSON export
- Native Dark, Light, and High-Contrast VS Code theme support

---

## LiteForge Pro (Optional Power Tools)

Upgrade once (**$19 Early Bird** / **$24 Perpetual One-Time** or **$5/mo**) via Polar.sh—no cloud account required, with a **14-day offline grace cache**:

- **Transactional Inline Cell & Row Editor:** Stage edits, preview exact `BEGIN/COMMIT` SQL diffs, and write back atomically.
- **Visual Schema & Foreign-Key ERD Inspector:** Explore tables, PKs, FKs, and indexes in an interactive relationship diagram.
- **2-File SQLite Schema Diff & Migration SQL Generator:** Compare two `.sqlite` files and generate deterministic `CREATE TABLE` / `ALTER TABLE` / `CREATE INDEX` SQL.
- **Full `.sql` Schema + Data Dump & Multi-Table Export:** Export complete transactional `.sql` scripts (including `X'...'` BLOB literals) or multi-table JSON bundles.

---

## Privacy & Security Disclosure

LiteForge collects **zero telemetry**, **zero analytics**, and **zero crash reports**. All `.sqlite` / `.db` files are opened and queried strictly in local memory via WebAssembly. Outbound network requests occur only if you choose to activate or validate a Polar.sh Pro license key (`https://api.polar.sh/v1/customer-portal/license-keys/*`).
```
