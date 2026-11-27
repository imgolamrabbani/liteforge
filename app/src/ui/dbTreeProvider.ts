import * as vscode from 'vscode';
import path from 'node:path';

export interface DbTreeNode {
  uri: vscode.Uri;
  label: string;
}

export class DbTreeProvider implements vscode.TreeDataProvider<DbTreeNode> {
  private readonly _onDidChangeTreeData =
    new vscode.EventEmitter<DbTreeNode | undefined | void>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire();
  }

  getTreeItem(element: DbTreeNode): vscode.TreeItem {
    const item = new vscode.TreeItem(
      element.label,
      vscode.TreeItemCollapsibleState.None
    );
    item.resourceUri = element.uri;
    item.iconPath = new vscode.ThemeIcon('database');
    item.tooltip = element.uri.fsPath;
    item.command = {
      command: 'vscode.openWith',
      title: 'Open in LiteForge SQLite Studio',
      arguments: [element.uri, 'liteforge.sqliteEditor'],
    };
    return item;
  }

  async getChildren(): Promise<DbTreeNode[]> {
    const uris = await vscode.workspace.findFiles(
      '**/*.{db,sqlite,sqlite3,db3,s3db}',
      '{**/node_modules/**,**/.git/**,**/dist/**,**/build/**}'
    );
    uris.sort((a, b) => a.fsPath.localeCompare(b.fsPath));

    const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    return uris.map((uri) => ({
      uri,
      label: root ? path.relative(root, uri.fsPath) : path.basename(uri.fsPath),
    }));
  }
}
