import { toHex } from '../shared/hex.ts';

export function hasSubtle(): boolean {
  try {
    return typeof crypto !== 'undefined' && typeof crypto.subtle?.digest === 'function';
  } catch {
    return false;
  }
}

export async function sha256Hex(bytes: BufferSource): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

/**
 * Recipe 1: lowercase hex SHA-256 of the UTF-8 bytes of `JSON.stringify([part, value])`.
 * The part name is inside the hashed text, so equal values of different parts
 * never share a digest.
 */
export function partDigest(part: string, value: unknown): Promise<string> {
  return sha256Hex(new TextEncoder().encode(JSON.stringify([part, value])));
}
