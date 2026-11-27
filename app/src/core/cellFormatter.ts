import type { CellValue, SerializedCell } from './types';

export function bytesToHex(bytes: Uint8Array, maxBytes = 64): string {
  const slice = bytes.subarray(0, maxBytes);
  const hex = Array.from(slice)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
  return bytes.length > maxBytes ? `${hex}...` : hex;
}

export function isJsonLikeString(value: string): boolean {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('{') && trimmed.endsWith('}')) ||
    (trimmed.startsWith('[') && trimmed.endsWith(']'))
  ) {
    try {
      JSON.parse(trimmed);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

export function formatCellForDisplay(value: CellValue): SerializedCell {
  if (value === null || value === undefined) {
    return { kind: 'null', display: 'NULL', raw: null };
  }
  if (value instanceof Uint8Array) {
    const preview = bytesToHex(value, 32);
    return {
      kind: 'blob',
      display: `BLOB(${value.byteLength}B) 0x${preview}`,
      raw: bytesToHex(value, value.byteLength),
      byteLength: value.byteLength,
    };
  }
  if (typeof value === 'number') {
    return { kind: 'number', display: String(value), raw: value };
  }
  if (isJsonLikeString(value)) {
    return {
      kind: 'json',
      display: value.length > 120 ? `${value.slice(0, 117)}...` : value,
      raw: value,
    };
  }
  return {
    kind: 'text',
    display: value.length > 160 ? `${value.slice(0, 157)}...` : value,
    raw: value,
  };
}

export function formatSqlLiteral(value: CellValue): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return Number.isFinite(value) ? String(value) : 'NULL';
  }
  if (value instanceof Uint8Array) {
    const hex = Array.from(value)
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join('');
    return `X'${hex}'`;
  }
  return `'${String(value).replace(/'/g, "''")}'`;
}
