import { bytesToHex } from './cellFormatter';
import type { CellValue } from './types';

function cellToString(val: CellValue): string {
  if (val === null || val === undefined) return '';
  if (val instanceof Uint8Array) return `0x${bytesToHex(val, val.byteLength)}`;
  return String(val);
}

function escapeCsv(val: string): string {
  if (/[",\r\n]/.test(val)) {
    return `"${val.replace(/"/g, '""')}"`;
  }
  return val;
}

export function exportTableCsv(columns: string[], rows: CellValue[][]): string {
  const header = columns.map(escapeCsv).join(',');
  const body = rows.map((row) =>
    row.map((cell) => escapeCsv(cellToString(cell))).join(',')
  );
  return [header, ...body].join('\r\n') + '\r\n';
}

export function exportTableJson(
  columns: string[],
  rows: CellValue[][]
): string {
  const objects = rows.map((row) => {
    const rec: Record<string, string | number | null> = {};
    columns.forEach((col, i) => {
      const val = row[i];
      if (val instanceof Uint8Array) {
        rec[col] = `0x${bytesToHex(val, val.byteLength)}`;
      } else {
        rec[col] = val ?? null;
      }
    });
    return rec;
  });
  return JSON.stringify(objects, null, 2) + '\n';
}
