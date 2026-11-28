import * as vscode from 'vscode';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  importCsvIntoSqlite,
  importJsonIntoSqlite,
} from './core/dataImporter';
import { SqliteWasmDatabase } from './core/wasmEngine';
import {
  FeatureGate,
  LicenseManager,
  PRO_FEATURE_LABELS,
  type ProFeatureId,
} from './licensing';
import { diffSqliteFiles } from './pro/dbDiff';
import { DbTreeProvider } from './ui/dbTreeProvider';
import { SqliteEditorProvider } from './ui/sqliteEditorProvider';

const DEFAULT_POLAR_ORG_ID = 'c9b3a57f-c07f-4f81-b9b8-aa9f5b497a1e';
const DEFAULT_CHECKOUT_URL =
  'https://buy.polar.sh/polar_cl_evSGX7ncQzq8ajjg2Jecr1Mwm8IHGVYwW7mNC3QEvGc';

export function activate(context: vscode.ExtensionContext): void {
  const cfg = vscode.workspace.getConfiguration('liteforge');
  const organizationId =
    cfg.get<string>('polarOrganizationId') || DEFAULT_POLAR_ORG_ID;
  const checkoutUrl =
    cfg.get<string>('polarCheckoutUrl') || DEFAULT_CHECKOUT_URL;

  const licenseManager = new LicenseManager(
    context.secrets,
    context.globalState,
    {
      organizationId,
      apiBaseUrl: 'https://api.polar.sh',
    }
  );
  const featureGate = new FeatureGate(licenseManager, checkoutUrl);

  const showProUpgradePrompt = (feature: ProFeatureId, url: string) => {
    const info = PRO_FEATURE_LABELS[feature];
    void vscode.window
      .showInformationMessage(
        `${info.title} is a LiteForge Pro feature. ${info.summary}`,
        'Upgrade to Pro',
        'Activate License Key'
      )
      .then((choice) => {
        if (choice === 'Upgrade to Pro') {
          void vscode.env.openExternal(vscode.Uri.parse(url));
        } else if (choice === 'Activate License Key') {
          void vscode.commands.executeCommand('liteforge.activateLicense');
        }
      });
  };

  const statusBar = vscode.window.createStatusBarItem(
    vscode.StatusBarAlignment.Right,
    90
  );
  statusBar.command = 'liteforge.showLicenseStatus';
  context.subscriptions.push(statusBar);

  const updateStatusBar = () => {
    const state = licenseManager.getState();
    statusBar.text =
      state.tier === 'pro'
        ? state.offlineGraceActive
          ? '$(database) LiteForge Pro (Offline)'
          : '$(database) LiteForge Pro'
        : '$(database) LiteForge Free';
    statusBar.tooltip =
      state.tier === 'pro'
        ? `LiteForge Pro (${state.keyMask || 'Active'})`
        : 'LiteForge Free — 100% Pure WASM SQLite Studio. Click to activate Pro.';
    statusBar.show();
  };

  updateStatusBar();
  void licenseManager.refreshIfNeeded().then(() => updateStatusBar());

  const editorProvider = new SqliteEditorProvider(
    context.extensionUri,
    licenseManager,
    featureGate,
    showProUpgradePrompt
  );
  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider(
      SqliteEditorProvider.viewType,
      editorProvider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

  const dbTree = new DbTreeProvider();
  context.subscriptions.push(
    vscode.window.createTreeView('liteforge.databases', {
      treeDataProvider: dbTree,
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('liteforge.openDatabase', async () => {
      const picked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          'SQLite Databases': ['db', 'sqlite', 'sqlite3', 'db3', 's3db'],
        },
        openLabel: 'Open in LiteForge',
      });
      if (picked?.[0]) {
        await vscode.commands.executeCommand(
          'vscode.openWith',
          picked[0],
          SqliteEditorProvider.viewType
        );
      }
    }),

    vscode.commands.registerCommand('liteforge.importData', async () => {
      const dataPicked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'CSV or JSON Data': ['csv', 'json'] },
        openLabel: 'Select CSV or JSON File to Import',
      });
      const dataUri = dataPicked?.[0];
      if (!dataUri) return;

      const dbPicked = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          'SQLite Databases': ['db', 'sqlite', 'sqlite3', 'db3', 's3db'],
        },
        openLabel: 'Select Target SQLite Database',
      });
      const dbUri = dbPicked?.[0];
      if (!dbUri) return;

      const defaultTable = path
        .basename(dataUri.fsPath, path.extname(dataUri.fsPath))
        .replace(/[^a-zA-Z0-9_]+/g, '_');
      const tableName = await vscode.window.showInputBox({
        prompt: 'Target SQLite table name',
        value: defaultTable || 'imported_table',
        ignoreFocusOut: true,
      });
      if (!tableName) return;

      try {
        const raw = await fs.readFile(dataUri.fsPath, 'utf8');
        const engine = await SqliteWasmDatabase.openFile(dbUri.fsPath);
        try {
          const isJson = dataUri.fsPath.toLowerCase().endsWith('.json');
          const res = isJson
            ? await importJsonIntoSqlite(engine, tableName, raw, dbUri.fsPath)
            : await importCsvIntoSqlite(engine, tableName, raw, dbUri.fsPath);
          dbTree.refresh();
          await vscode.commands.executeCommand(
            'vscode.openWith',
            dbUri,
            SqliteEditorProvider.viewType
          );
          void vscode.window.showInformationMessage(
            `Imported ${res.rowCount} row(s) (${res.columnCount} columns) into table "${res.tableName}".`
          );
        } finally {
          engine.close();
        }
      } catch (err) {
        void vscode.window.showErrorMessage(
          `Import failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),

    vscode.commands.registerCommand('liteforge.refreshDatabases', () => {
      dbTree.refresh();
    }),

    vscode.commands.registerCommand('liteforge.compareDatabases', async () => {
      if (!featureGate.requirePro('db_diff', showProUpgradePrompt)) return;
      const first = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          'SQLite Databases': ['db', 'sqlite', 'sqlite3', 'db3', 's3db'],
        },
        openLabel: 'Select Baseline (Source) SQLite File',
      });
      if (!first?.[0]) return;
      const second = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: {
          'SQLite Databases': ['db', 'sqlite', 'sqlite3', 'db3', 's3db'],
        },
        openLabel: 'Select Target (New) SQLite File',
      });
      if (!second?.[0]) return;

      const diff = await diffSqliteFiles(first[0].fsPath, second[0].fsPath);
      const doc = await vscode.workspace.openTextDocument({
        language: 'sql',
        content: diff.fullMigrationSql,
      });
      await vscode.window.showTextDocument(doc);
    }),

    vscode.commands.registerCommand('liteforge.activateLicense', async () => {
      const key = await vscode.window.showInputBox({
        prompt: 'Enter your LiteForge Pro license key (from Polar.sh)',
        placeHolder: 'LITEFORGE-XXXX-XXXX-XXXX',
        password: true,
        ignoreFocusOut: true,
      });
      if (!key) return;
      try {
        const state = await licenseManager.activate(key, os.hostname());
        updateStatusBar();
        void vscode.window.showInformationMessage(
          `LiteForge Pro activated (${state.keyMask || 'Pro'})!`
        );
      } catch (err) {
        void vscode.window.showErrorMessage(
          `License activation failed: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }),

    vscode.commands.registerCommand('liteforge.deactivateLicense', async () => {
      await licenseManager.deactivate();
      updateStatusBar();
      void vscode.window.showInformationMessage(
        'LiteForge Pro license deactivated on this machine.'
      );
    }),

    vscode.commands.registerCommand('liteforge.showLicenseStatus', async () => {
      const state = licenseManager.getState();
      if (state.tier === 'pro') {
        const msg = state.offlineGraceActive
          ? `LiteForge Pro (${state.keyMask}) — Offline Grace active until ${state.graceUntilIso}`
          : `LiteForge Pro (${state.keyMask}) — Active & verified ${state.validatedAtIso}`;
        const choice = await vscode.window.showInformationMessage(
          msg,
          'Refresh Validation',
          'Deactivate License'
        );
        if (choice === 'Refresh Validation') {
          await licenseManager.refreshIfNeeded(true);
          updateStatusBar();
        } else if (choice === 'Deactivate License') {
          await vscode.commands.executeCommand('liteforge.deactivateLicense');
        }
      } else {
        const choice = await vscode.window.showInformationMessage(
          'LiteForge Free — 100% Pure WASM SQLite Studio. Upgrade to Pro for Transactional Inline Editing, Visual Schema/FK ERD, 2-File DB Diff & Full SQL Dump.',
          'Activate License Key',
          'Get LiteForge Pro'
        );
        if (choice === 'Activate License Key') {
          await vscode.commands.executeCommand('liteforge.activateLicense');
        } else if (choice === 'Get LiteForge Pro') {
          void vscode.env.openExternal(
            vscode.Uri.parse(featureGate.getCheckoutUrl())
          );
        }
      }
    })
  );
}

export function deactivate(): void {
  // Handled via subscriptions
}
