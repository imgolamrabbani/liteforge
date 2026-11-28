# LiteForge — Zero-Dependency WASM SQLite Studio

**Zero-Dependency WASM SQLite Studio for VS Code. Browse, Query, Edit & Diff `.sqlite` Files Locally.**

Built on pure WebAssembly (`sql.js`), LiteForge requires **zero native `sqlite3` CLI binaries** and **zero shared libraries (`libtinfo.so.5`)**. It works identically on macOS (Apple Silicon & Intel), Windows, Linux, Remote-SSH, WSL, DevContainers, and Codespaces — and is 100% immune to SQLite 3.41+ `DQS=0` crashes.

## Free vs. Pro

| Capability | Free ($0 Forever) | Pro ($19 Early Bird / $24 Std / $5 mo) |
|---|---|---|
| Custom Editor for `.db`, `.sqlite`, `.sqlite3`, `.db3`, `.s3db` | Included | Included |
| Paginated Table Grid (Sort, Search, `NULL` / BLOB Hex / JSON Inspector) | Included | Included |
| Multi-Tab SQL Query Runner with timing & error reporting | Included | Included |
| Single-Table RFC-4180 CSV & JSON Export + **CSV / JSON Table Importer** | Included | Included |
| **Transactional Inline Cell/Row Editor** (SQL diff preview + atomic write-back) | — | Included |
| **Visual Schema & Foreign-Key ERD Inspector** | — | Included |
| **Local 2-File SQLite Schema Diff & Migration SQL Generator** | — | Included |
| **Full `.sql` Schema + Data Dump & Multi-Table JSON Bundle** | — | Included |

## Privacy & Security Disclosure

- **Zero Telemetry:** LiteForge collects zero analytics, crash reports, or database metadata.
- **100% Local WebAssembly Execution:** Your `.sqlite` files never leave your machine.
- **Network Access:** Zero outbound network calls except optional, user-initiated Polar.sh license activation/validation (with 14-day offline grace).

Homepage & Privacy Policy: [https://imgolamrabbani.github.io/liteforge/](https://imgolamrabbani.github.io/liteforge/)
