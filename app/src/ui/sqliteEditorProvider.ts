import * as vscode from 'vscode';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatCellForDisplay } from '../core/cellFormatter';
import { exportTableCsv, exportTableJson } from '../core/tableExporter';
import type {
  CellValue,
  DbDiffResult,
  PageQueryOptions,
  SerializedCell,
  StagedEdit,
  TableSchema,
} from '../core/types';
import { SqliteWasmDatabase } from '../core/wasmEngine';
import type {
  FeatureGate,
  LicenseManager,
  LicenseState,
  ProFeatureId,
} from '../licensing';
import { diffSqliteFiles } from '../pro/dbDiff';
import {
  applyStagedEditsAtomic,
  previewStagedEdits,
} from '../pro/inlineEditor';
import { extractErdFromDatabase } from '../pro/schemaErd';
import {
  dumpDatabaseToMultiTableJson,
  dumpDatabaseToSql,
} from '../pro/sqlDumper';

class SqliteCustomDocument implements vscode.CustomDocument {
  constructor(
    public readonly uri: vscode.Uri,
    public readonly engine: SqliteWasmDatabase
  ) {}

  dispose(): void {
    this.engine.close();
  }
}

export interface SerializedPageResult {
  table: string;
  columns: string[];
  rows: Array<{ rowid: number | null; cells: SerializedCell[] }>;
  totalRows: number;
  page: number;
  pageSize: number;
  durationMs: number;
}

export interface SerializedSqlResult {
  columns: string[];
  rows: SerializedCell[][];
  rowsAffected: number;
  durationMs: number;
  error?: string;
}

export interface EditorStateSnapshot {
  fileName: string;
  filePath: string;
  tables: TableSchema[];
  activeTable?: string;
  pageData?: SerializedPageResult;
  sqlResult?: SerializedSqlResult;
  erdGraph?: ReturnType<typeof extractErdFromDatabase>;
  diffResult?: DbDiffResult;
  license: LicenseState;
  checkoutUrl: string;
}

type WebviewMessage =
  | { type: 'ready' }
  | { type: 'loadPage'; options: PageQueryOptions }
  | { type: 'runSql'; sql: string }
  | { type: 'exportTable'; table: string; format: 'csv' | 'json' }
  | { type: 'previewEdits'; edits: StagedEdit[] }
  | { type: 'applyEdits'; edits: StagedEdit[]; activeTable: string }
  | { type: 'loadErd' }
  | { type: 'pickAndDiffDatabase' }
  | { type: 'dumpDatabase'; format: 'sql' | 'json' }
  | { type: 'activateLicense' }
  | { type: 'openCheckout' };

export class SqliteEditorProvider
  implements vscode.CustomReadonlyEditorProvider<SqliteCustomDocument>
{
  public static readonly viewType = 'liteforge.sqliteEditor';

  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly licenseManager: LicenseManager,
    private readonly featureGate: FeatureGate,
    private readonly onProBlocked: (feature: ProFeatureId, checkoutUrl: string) => void
  ) {}

  async openCustomDocument(uri: vscode.Uri): Promise<SqliteCustomDocument> {
    const engine = await SqliteWasmDatabase.openFile(uri.fsPath);
    return new SqliteCustomDocument(uri, engine);
  }

  async resolveCustomEditor(
    document: SqliteCustomDocument,
    webviewPanel: vscode.WebviewPanel
  ): Promise<void> {
    webviewPanel.webview.options = {
      enableScripts: true,
      localResourceRoots: [
        vscode.Uri.joinPath(this.extensionUri, 'dist', 'webview'),
      ],
    };
    webviewPanel.webview.html = this.buildHtml(webviewPanel.webview);

    const cfg = vscode.workspace.getConfiguration('liteforge');
    const defaultPageSize = cfg.get<number>('defaultPageSize') ?? 100;

    let tables = document.engine.listTables();
    let activeTable = tables[0]?.name;
    let lastPageData: SerializedPageResult | undefined;
    let lastSqlResult: SerializedSqlResult | undefined;
    let lastErdGraph: ReturnType<typeof extractErdFromDatabase> | undefined;
    let lastDiffResult: DbDiffResult | undefined;

    const loadSerializedPage = (
      opts: PageQueryOptions
    ): SerializedPageResult => {
      const raw = document.engine.queryPage(opts);
      return {
        table: raw.table,
        columns: raw.columns,
        rows: raw.rows.map((r) => ({
          rowid: r.rowid,
          cells: r.values.map(formatCellForDisplay),
        })),
        totalRows: raw.totalRows,
        page: raw.page,
        pageSize: raw.pageSize,
        durationMs: raw.durationMs,
      };
    };

    const pushState = () => {
      const payload: EditorStateSnapshot = {
        fileName: path.basename(document.uri.fsPath),
        filePath: document.uri.fsPath,
        tables,
        activeTable,
        pageData: lastPageData,
        sqlResult: lastSqlResult,
        erdGraph: lastErdGraph,
        diffResult: lastDiffResult,
        license: this.licenseManager.getState(),
        checkoutUrl: this.featureGate.getCheckoutUrl(),
      };
      void webviewPanel.webview.postMessage({ type: 'state', payload });
    };

    const postToast = (level: 'info' | 'error' | 'warning', message: string) => {
      void webviewPanel.webview.postMessage({ type: 'toast', level, message });
    };

    webviewPanel.webview.onDidReceiveMessage(async (msg: WebviewMessage) => {
      try {
        switch (msg.type) {
          case 'ready':
            tables = document.engine.listTables();
            activeTable = activeTable ?? tables[0]?.name;
            if (activeTable) {
              lastPageData = loadSerializedPage({
                table: activeTable,
                page: 1,
                pageSize: defaultPageSize,
              });
            }
            pushState();
            break;

          case 'loadPage':
            activeTable = msg.options.table;
            lastPageData = loadSerializedPage(msg.options);
            pushState();
            break;

          case 'runSql': {
            const raw = document.engine.runSql(msg.sql);
            lastSqlResult = {
              columns: raw.columns,
              rows: raw.rows.map((r) => r.map(formatCellForDisplay)),
              rowsAffected: raw.rowsAffected,
              durationMs: raw.durationMs,
              error: raw.error,
            };
            tables = document.engine.listTables();
            pushState();
            break;
          }

          case 'exportTable': {
            const raw = document.engine.queryPage({
              table: msg.table,
              page: 1,
              pageSize: 100_000,
            });
            const matrix: CellValue[][] = raw.rows.map((r) => r.values);
            const content =
              msg.format === 'csv'
                ? exportTableCsv(raw.columns, matrix)
                : exportTableJson(raw.columns, matrix);
            const saveUri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(
                path.join(
                  path.dirname(document.uri.fsPath),
                  `${msg.table}.${msg.format}`
                )
              ),
            });
            if (saveUri) {
              await fs.writeFile(saveUri.fsPath, content, 'utf8');
              postToast('info', `Exported ${msg.table} to ${path.basename(saveUri.fsPath)}`);
            }
            break;
          }

          case 'previewEdits': {
            if (!this.featureGate.requirePro('inline_edit', this.onProBlocked)) {
              return;
            }
            const preview = previewStagedEdits(msg.edits);
            void webviewPanel.webview.postMessage({
              type: 'editPreview',
              preview,
            });
            break;
          }

          case 'applyEdits': {
            if (!this.featureGate.requirePro('inline_edit', this.onProBlocked)) {
              return;
            }
            const { appliedCount } = await applyStagedEditsAtomic(
              document.engine,
              msg.edits,
              document.uri.fsPath
            );
            tables = document.engine.listTables();
            activeTable = msg.activeTable;
            lastPageData = loadSerializedPage({
              table: activeTable,
              page: 1,
              pageSize: defaultPageSize,
            });
            postToast(
              'info',
              `Applied ${appliedCount} edit(s) atomically to ${path.basename(document.uri.fsPath)}.`
            );
            pushState();
            break;
          }

          case 'loadErd': {
            if (!this.featureGate.requirePro('schema_erd', this.onProBlocked)) {
              return;
            }
            lastErdGraph = extractErdFromDatabase(document.engine);
            pushState();
            break;
          }

          case 'pickAndDiffDatabase': {
            if (!this.featureGate.requirePro('db_diff', this.onProBlocked)) {
              return;
            }
            const picked = await vscode.window.showOpenDialog({
              canSelectMany: false,
              filters: {
                'SQLite Databases': ['db', 'sqlite', 'sqlite3', 'db3', 's3db'],
              },
              openLabel: 'Compare Against Target SQLite File',
            });
            const target = picked?.[0];
            if (!target) return;
            lastDiffResult = await diffSqliteFiles(
              document.uri.fsPath,
              target.fsPath
            );
            postToast(
              'info',
              `Diff complete: ${lastDiffResult.differences.length} schema difference(s).`
            );
            pushState();
            break;
          }

          case 'dumpDatabase': {
            if (!this.featureGate.requirePro('sql_dump', this.onProBlocked)) {
              return;
            }
            const base = path.basename(
              document.uri.fsPath,
              path.extname(document.uri.fsPath)
            );
            const content =
              msg.format === 'sql'
                ? dumpDatabaseToSql(document.engine)
                : dumpDatabaseToMultiTableJson(document.engine);
            const saveUri = await vscode.window.showSaveDialog({
              defaultUri: vscode.Uri.file(
                path.join(
                  path.dirname(document.uri.fsPath),
                  `${base}-dump.${msg.format}`
                )
              ),
            });
            if (saveUri) {
              await fs.writeFile(saveUri.fsPath, content, 'utf8');
              postToast('info', `Saved full ${msg.format.toUpperCase()} dump to ${path.basename(saveUri.fsPath)}`);
            }
            break;
          }

          case 'activateLicense':
            await vscode.commands.executeCommand('liteforge.activateLicense');
            pushState();
            break;

          case 'openCheckout':
            void vscode.env.openExternal(
              vscode.Uri.parse(this.featureGate.getCheckoutUrl())
            );
            break;
        }
      } catch (err) {
        postToast('error', err instanceof Error ? err.message : String(err));
      }
    });
  }

  private buildHtml(webview: vscode.Webview): string {
    const nonce = crypto.randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'dist',
        'webview',
        'assets',
        'index.js'
      )
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(
        this.extensionUri,
        'dist',
        'webview',
        'assets',
        'index.css'
      )
    );

    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');

    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LiteForge SQLite Studio</title>
    <link rel="stylesheet" href="${styleUri}" />
  </head>
  <body>
    <div id="root"></div>
    <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
  </body>
</html>`;
  }
}
