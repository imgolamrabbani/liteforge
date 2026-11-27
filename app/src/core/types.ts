export type CellValue = string | number | Uint8Array | null;

export interface SerializedCell {
  kind: 'null' | 'number' | 'text' | 'json' | 'blob';
  display: string;
  raw: string | number | null;
  byteLength?: number;
}

export interface ColumnSchema {
  cid: number;
  name: string;
  type: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: number;
}

export interface ForeignKeySchema {
  id: number;
  fromTable: string;
  fromColumn: string;
  toTable: string;
  toColumn: string;
  onUpdate: string;
  onDelete: string;
}

export interface IndexSchema {
  name: string;
  tableName: string;
  unique: boolean;
  columns: string[];
  sql: string | null;
}

export interface TableSchema {
  name: string;
  type: 'table' | 'view';
  sql: string;
  rowCount: number;
  columns: ColumnSchema[];
  foreignKeys: ForeignKeySchema[];
  indexes: IndexSchema[];
}

export interface PageQueryOptions {
  table: string;
  page: number;
  pageSize: number;
  sortColumn?: string;
  sortDir?: 'ASC' | 'DESC';
  search?: string;
}

export interface PageResult {
  table: string;
  columns: string[];
  rows: Array<{ rowid: number | null; values: CellValue[] }>;
  totalRows: number;
  page: number;
  pageSize: number;
  durationMs: number;
}

export interface SqlQueryResult {
  columns: string[];
  rows: CellValue[][];
  rowsAffected: number;
  durationMs: number;
  error?: string;
}

export interface StagedEdit {
  kind: 'update' | 'insert' | 'delete';
  table: string;
  rowid?: number;
  column?: string;
  oldValue?: CellValue;
  newValue?: CellValue;
  rowValues?: Record<string, CellValue>;
}

export interface EditPreviewResult {
  statements: string[];
  affectedRows: number;
}

export interface ErdGraph {
  tables: Array<{
    name: string;
    columns: ColumnSchema[];
    rowCount: number;
  }>;
  edges: ForeignKeySchema[];
}

export interface SchemaDiffItem {
  kind:
    | 'table_added'
    | 'table_removed'
    | 'column_added'
    | 'column_removed'
    | 'column_type_changed'
    | 'index_added'
    | 'index_removed';
  table: string;
  detail: string;
  migrationSql: string;
  destructive: boolean;
}

export interface DbDiffResult {
  sourcePath: string;
  targetPath: string;
  differences: SchemaDiffItem[];
  fullMigrationSql: string;
}
