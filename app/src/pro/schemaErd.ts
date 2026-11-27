import type { ErdGraph, TableSchema } from '../core/types';
import type { SqliteWasmDatabase } from '../core/wasmEngine';

export function buildErdGraph(tables: TableSchema[]): ErdGraph {
  const userTables = tables.filter((t) => t.type === 'table');
  const edges = userTables.flatMap((t) => t.foreignKeys);

  return {
    tables: userTables.map((t) => ({
      name: t.name,
      columns: t.columns,
      rowCount: t.rowCount,
    })),
    edges,
  };
}

export function extractErdFromDatabase(engine: SqliteWasmDatabase): ErdGraph {
  return buildErdGraph(engine.listTables());
}
