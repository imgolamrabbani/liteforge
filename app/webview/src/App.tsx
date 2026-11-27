import React, { useEffect, useState } from 'react';
import { postToExtension } from './vscodeApi';

interface SerializedCell {
  kind: 'null' | 'number' | 'text' | 'json' | 'blob';
  display: string;
  raw: string | number | null;
  byteLength?: number;
}

interface ColumnSchema {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: number;
}

interface ForeignKeySchema {
  id: number;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
}

interface TableSchema {
  name: string;
  type: 'table' | 'view';
  rowCount: number;
  columns: ColumnSchema[];
  foreignKeys: ForeignKeySchema[];
}

interface EditorStateSnapshot {
  fileName: string;
  filePath: string;
  tables: TableSchema[];
  activeTable?: string;
  pageData?: {
    table: string;
    columns: string[];
    rows: Array<{ rowid: number | null; cells: SerializedCell[] }>;
    totalRows: number;
    page: number;
    pageSize: number;
    durationMs: number;
  };
  sqlResult?: {
    columns: string[];
    rows: SerializedCell[][];
    rowsAffected: number;
    durationMs: number;
    error?: string;
  };
  erdGraph?: {
    tables: Array<{ name: string; columns: ColumnSchema[]; rowCount: number }>;
    edges: ForeignKeySchema[];
  };
  diffResult?: {
    sourcePath: string;
    targetPath: string;
    differences: Array<{
      kind: string;
      table: string;
      detail: string;
      migrationSql: string;
      destructive: boolean;
    }>;
    fullMigrationSql: string;
  };
  license: {
    tier: 'free' | 'pro';
    keyMask?: string;
    offlineGraceActive: boolean;
  };
  checkoutUrl: string;
}

interface StagedEdit {
  kind: 'update' | 'insert' | 'delete';
  table: string;
  rowid?: number;
  column?: string;
  oldValue?: string | number | null;
  newValue?: string | number | null;
}

type StudioTab = 'data' | 'sql' | 'erd' | 'diff' | 'dump';

export const App: React.FC = () => {
  const [state, setState] = useState<EditorStateSnapshot | null>(null);
  const [tab, setTab] = useState<StudioTab>('data');
  const [search, setSearch] = useState('');
  const [sortCol, setSortCol] = useState<string | undefined>();
  const [sortDir, setSortDir] = useState<'ASC' | 'DESC'>('ASC');
  const [sqlText, setSqlText] = useState('SELECT name, type FROM sqlite_master WHERE type IN (\'table\', \'view\');');
  const [selectedCell, setSelectedCell] = useState<{
    col: string;
    rowid: number | null;
    cell: SerializedCell;
  } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [stagedEdits, setStagedEdits] = useState<StagedEdit[]>([]);
  const [editPreview, setEditPreview] = useState<string[] | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    const handler = (event: MessageEvent) => {
      const msg = event.data;
      if (msg?.type === 'state') {
        setState(msg.payload as EditorStateSnapshot);
      } else if (msg?.type === 'editPreview') {
        setEditPreview(msg.preview?.statements ?? []);
      } else if (msg?.type === 'toast') {
        setToast(msg.message);
        setTimeout(() => setToast(null), 4000);
      }
    };
    window.addEventListener('message', handler);
    postToExtension({ type: 'ready' });
    return () => window.removeEventListener('message', handler);
  }, []);

  if (!state) {
    return (
      <div className="studio" style={{ padding: 20 }}>
        <p className="muted">Loading WASM SQLite Engine...</p>
      </div>
    );
  }

  const loadPage = (
    table: string,
    page = 1,
    nextSortCol = sortCol,
    nextSortDir = sortDir,
    nextSearch = search
  ) => {
    postToExtension({
      type: 'loadPage',
      options: {
        table,
        page,
        pageSize: state.pageData?.pageSize ?? 100,
        sortColumn: nextSortCol,
        sortDir: nextSortDir,
        search: nextSearch,
      },
    });
  };

  const toggleSort = (col: string) => {
    if (!state.activeTable) return;
    const nextDir: 'ASC' | 'DESC' =
      sortCol === col && sortDir === 'ASC' ? 'DESC' : 'ASC';
    setSortCol(col);
    setSortDir(nextDir);
    loadPage(state.activeTable, 1, col, nextDir, search);
  };

  const pageData = state.pageData;
  const totalPages = pageData
    ? Math.max(1, Math.ceil(pageData.totalRows / pageData.pageSize))
    : 1;

  return (
    <div className="studio">
      <div className="topbar">
        <div className="group">
          <strong>LiteForge</strong>
          <span className="muted">{state.fileName}</span>
          <span
            className={`badge ${state.license.tier === 'pro' ? 'badge-pro' : ''}`}
          >
            {state.license.tier === 'pro' ? 'PRO' : 'FREE'}
          </span>
        </div>
        <div className="group">
          {state.activeTable && (
            <>
              <button
                className="btn"
                onClick={() =>
                  postToExtension({
                    type: 'exportTable',
                    table: state.activeTable,
                    format: 'csv',
                  })
                }
              >
                Export CSV
              </button>
              <button
                className="btn"
                onClick={() =>
                  postToExtension({
                    type: 'exportTable',
                    table: state.activeTable,
                    format: 'json',
                  })
                }
              >
                Export JSON
              </button>
            </>
          )}
          {state.license.tier === 'free' && (
            <button
              className="btn btn-primary"
              onClick={() => postToExtension({ type: 'activateLicense' })}
            >
              Activate Pro
            </button>
          )}
        </div>
      </div>

      <div className="body-split">
        <div className="sidebar">
          <div className="muted" style={{ marginBottom: 6, fontWeight: 600 }}>
            TABLES &amp; VIEWS ({state.tables.length})
          </div>
          {state.tables.map((t) => (
            <button
              key={t.name}
              className={`table-btn ${state.activeTable === t.name ? 'active' : ''}`}
              onClick={() => {
                setSortCol(undefined);
                setSearch('');
                setSelectedCell(null);
                setTab('data');
                loadPage(t.name, 1, undefined, 'ASC', '');
              }}
            >
              <span>{t.name}</span>
              <span className="muted">{t.rowCount}</span>
            </button>
          ))}
        </div>

        <div className="main">
          <div className="tabs">
            <button
              className={`tab ${tab === 'data' ? 'active' : ''}`}
              onClick={() => setTab('data')}
            >
              Data Grid
            </button>
            <button
              className={`tab ${tab === 'sql' ? 'active' : ''}`}
              onClick={() => setTab('sql')}
            >
              SQL Runner
            </button>
            <button
              className={`tab ${tab === 'erd' ? 'active' : ''}`}
              onClick={() => {
                setTab('erd');
                postToExtension({ type: 'loadErd' });
              }}
            >
              Schema &amp; ERD (Pro)
            </button>
            <button
              className={`tab ${tab === 'diff' ? 'active' : ''}`}
              onClick={() => setTab('diff')}
            >
              DB Diff (Pro)
            </button>
            <button
              className={`tab ${tab === 'dump' ? 'active' : ''}`}
              onClick={() => setTab('dump')}
            >
              Full Dump (Pro)
            </button>
          </div>

          <div className="content">
            {tab === 'data' && pageData && (
              <div>
                <div className="group" style={{ marginBottom: 10, justifyContent: 'space-between' }}>
                  <div className="group">
                    <input
                      className="input"
                      placeholder="Quick search table..."
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && state.activeTable) {
                          loadPage(state.activeTable, 1, sortCol, sortDir, search);
                        }
                      }}
                    />
                    <button
                      className="btn"
                      onClick={() =>
                        state.activeTable &&
                        loadPage(state.activeTable, 1, sortCol, sortDir, search)
                      }
                    >
                      Filter
                    </button>
                    <span className="muted">
                      {pageData.totalRows} rows · {pageData.durationMs}ms
                    </span>
                  </div>
                  <div className="group">
                    <button
                      className="btn"
                      disabled={pageData.page <= 1}
                      onClick={() =>
                        state.activeTable &&
                        loadPage(state.activeTable, pageData.page - 1)
                      }
                    >
                      Prev
                    </button>
                    <span className="muted">
                      Page {pageData.page} / {totalPages}
                    </span>
                    <button
                      className="btn"
                      disabled={pageData.page >= totalPages}
                      onClick={() =>
                        state.activeTable &&
                        loadPage(state.activeTable, pageData.page + 1)
                      }
                    >
                      Next
                    </button>
                  </div>
                </div>

                {stagedEdits.length > 0 && (
                  <div className="card" style={{ marginBottom: 10 }}>
                    <div className="group" style={{ justifyContent: 'space-between' }}>
                      <strong>Staged Edits: {stagedEdits.length}</strong>
                      <div className="group">
                        <button
                          className="btn"
                          onClick={() =>
                            postToExtension({
                              type: 'previewEdits',
                              edits: stagedEdits,
                            })
                          }
                        >
                          Preview SQL Diff
                        </button>
                        <button
                          className="btn btn-primary"
                          onClick={() => {
                            if (!state.activeTable) return;
                            postToExtension({
                              type: 'applyEdits',
                              edits: stagedEdits,
                              activeTable: state.activeTable,
                            });
                            setStagedEdits([]);
                            setEditPreview(null);
                          }}
                        >
                          Apply Atomically (Pro)
                        </button>
                        <button
                          className="btn"
                          onClick={() => {
                            setStagedEdits([]);
                            setEditPreview(null);
                          }}
                        >
                          Discard
                        </button>
                      </div>
                    </div>
                    {editPreview && (
                      <pre className="code-block" style={{ marginTop: 8 }}>
                        {editPreview.join('\n')}
                      </pre>
                    )}
                  </div>
                )}

                <div style={{ overflow: 'auto', maxHeight: '55vh' }}>
                  <table className="grid-table">
                    <thead>
                      <tr>
                        {pageData.columns.map((c) => (
                          <th key={c} onClick={() => toggleSort(c)}>
                            {c}
                            {sortCol === c ? (sortDir === 'ASC' ? ' ▲' : ' ▼') : ''}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {pageData.rows.map((row, rIdx) => (
                        <tr key={rIdx}>
                          {row.cells.map((cell, cIdx) => (
                            <td
                              key={cIdx}
                              className={
                                cell.kind === 'null'
                                  ? 'cell-null'
                                  : cell.kind === 'blob'
                                    ? 'cell-blob'
                                    : ''
                              }
                              onClick={() => {
                                setSelectedCell({
                                  col: pageData.columns[cIdx],
                                  rowid: row.rowid,
                                  cell,
                                });
                                setEditValue(
                                  cell.raw === null ? '' : String(cell.raw)
                                );
                              }}
                            >
                              {cell.display}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {selectedCell && (
                  <div className="card" style={{ marginTop: 12 }}>
                    <div className="group" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                      <strong>
                        Cell Inspector: <code>{selectedCell.col}</code> ({selectedCell.cell.kind.toUpperCase()})
                      </strong>
                      {selectedCell.rowid !== null && state.activeTable && (
                        <button
                          className="btn btn-primary"
                          onClick={() => {
                            setStagedEdits((prev) => [
                              ...prev,
                              {
                                kind: 'update',
                                table: state.activeTable!,
                                rowid: selectedCell.rowid!,
                                column: selectedCell.col,
                                oldValue: selectedCell.cell.raw,
                                newValue: editValue,
                              },
                            ]);
                          }}
                        >
                          Stage Cell Edit (Pro)
                        </button>
                      )}
                    </div>
                    <textarea
                      className="textarea"
                      style={{ minHeight: 70 }}
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                    />
                  </div>
                )}
              </div>
            )}

            {tab === 'sql' && (
              <div>
                <textarea
                  className="textarea"
                  value={sqlText}
                  onChange={(e) => setSqlText(e.target.value)}
                />
                <div className="group" style={{ margin: '8px 0 12px' }}>
                  <button
                    className="btn btn-primary"
                    onClick={() => postToExtension({ type: 'runSql', sql: sqlText })}
                  >
                    Run SQL
                  </button>
                  {state.sqlResult && (
                    <span className="muted">
                      {state.sqlResult.rows.length} rows · {state.sqlResult.durationMs}ms
                    </span>
                  )}
                </div>
                {state.sqlResult?.error ? (
                  <pre className="code-block err">{state.sqlResult.error}</pre>
                ) : state.sqlResult && state.sqlResult.columns.length > 0 ? (
                  <table className="grid-table">
                    <thead>
                      <tr>
                        {state.sqlResult.columns.map((c) => (
                          <th key={c}>{c}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {state.sqlResult.rows.map((r, i) => (
                        <tr key={i}>
                          {r.map((cell, j) => (
                            <td key={j}>{cell.display}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                ) : null}
              </div>
            )}

            {tab === 'erd' && (
              <div>
                {state.erdGraph ? (
                  <>
                    <div className="erd-grid">
                      {state.erdGraph.tables.map((t) => (
                        <div className="card" key={t.name}>
                          <strong>{t.name}</strong>{' '}
                          <span className="muted">({t.rowCount} rows)</span>
                          <ul style={{ paddingLeft: 16, margin: '8px 0 0' }}>
                            {t.columns.map((c) => (
                              <li key={c.name} style={{ fontSize: 12 }}>
                                <code>{c.name}</code>{' '}
                                <span className="muted">
                                  {c.type || 'ANY'}
                                  {c.primaryKey > 0 ? ' [PK]' : ''}
                                  {c.notNull ? ' NOT NULL' : ''}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </div>
                    <strong>Foreign-Key Relationships ({state.erdGraph.edges.length})</strong>
                    {state.erdGraph.edges.length === 0 ? (
                      <p className="muted">No foreign-key constraints defined.</p>
                    ) : (
                      <pre className="code-block" style={{ marginTop: 8 }}>
                        {state.erdGraph.edges
                          .map(
                            (e) =>
                              `${e.fromTable}.${e.fromColumn}  --->  ${e.toTable}.${e.toColumn}`
                          )
                          .join('\n')}
                      </pre>
                    )}
                  </>
                ) : (
                  <p className="muted">
                    Schema &amp; Foreign-Key ERD Inspector requires LiteForge Pro.
                  </p>
                )}
              </div>
            )}

            {tab === 'diff' && (
              <div>
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    postToExtension({ type: 'pickAndDiffDatabase' })
                  }
                >
                  Pick Target SQLite File to Compare (Pro)
                </button>
                {state.diffResult && (
                  <div style={{ marginTop: 12 }}>
                    <p className="muted">
                      Found {state.diffResult.differences.length} schema difference(s).
                    </p>
                    <pre className="code-block">
                      {state.diffResult.fullMigrationSql}
                    </pre>
                  </div>
                )}
              </div>
            )}

            {tab === 'dump' && (
              <div className="group">
                <button
                  className="btn btn-primary"
                  onClick={() =>
                    postToExtension({ type: 'dumpDatabase', format: 'sql' })
                  }
                >
                  Export Full Transactional .sql Dump (Pro)
                </button>
                <button
                  className="btn"
                  onClick={() =>
                    postToExtension({ type: 'dumpDatabase', format: 'json' })
                  }
                >
                  Export Multi-Table JSON Bundle (Pro)
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
};
