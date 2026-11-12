import { toHex } from '../shared/hex.ts';

/**
 * A WebCrypto key imported for HMAC-SHA256 signing. Declared structurally so
 * that the published types do not depend on the DOM library.
 */
export interface HmacKey {
  readonly type: string;
  readonly extractable: boolean;
  readonly algorithm: object;
  readonly usages: readonly string[];
}

/**
 * An HMAC-SHA256 key: at least 16 raw bytes (32 recommended), or a key already
 * imported with `crypto.subtle.importKey` for signing.
 *
 * Treat key bytes as immutable. Each `Uint8Array` is imported once and the
 * import is remembered for that array object, so create the array once at
 * startup and reuse it: overwriting its contents later does not change the key
 * in use, and creating a new array per request imports the key every time.
 */
export type KeyInput = HmacKey | Uint8Array;

const MIN_KEY_BYTES = 16;
const MAX_BASE64_LENGTH = 1024;

// Importing a key is the slow step, so each byte array is imported once.
const imported = new WeakMap<Uint8Array, Promise<CryptoKey>>();

/**
 * Decodes a base64 or base64url string into key bytes. Call it once and keep
 * the result (see {@link KeyInput}).
 * @throws RangeError when the text is not valid base64.
 */
export function keyFromBase64(text: string): Uint8Array {
  if (typeof text !== 'string' || text.length > MAX_BASE64_LENGTH) {
    throw new RangeError('r-detect: key is not valid base64');
  }
  const normal = text.trim().replace(/-/g, '+').replace(/_/g, '/').replace(/=+$/, '');
  if (normal === '' || !/^[A-Za-z0-9+/]+$/.test(normal) || normal.length % 4 === 1) {
    throw new RangeError('r-detect: key is not valid base64');
  }
  const binary = atob(normal + '='.repeat((4 - (normal.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Checks that a value can be used as a key.
 * @throws RangeError when the key is shorter than 16 bytes or is not an HMAC-SHA256 signing key.
 * @throws TypeError when the value is neither bytes nor an imported key.
 */
export function assertKey(key: KeyInput): void {
  if (key instanceof Uint8Array) {
    if (key.byteLength < MIN_KEY_BYTES) {
      throw new RangeError(
        `r-detect: key must be at least ${MIN_KEY_BYTES} bytes, got ${key.byteLength}`,
      );
    }
    return;
  }
  const candidate = key as { algorithm?: unknown; usages?: unknown } | null;
  const usages = candidate?.usages;
  const algorithm = candidate?.algorithm as
    | { name?: unknown; length?: unknown; hash?: { name?: unknown } }
    | null
    | undefined;
  if (!Array.isArray(usages) || typeof algorithm !== 'object' || algorithm === null) {
    throw new TypeError('r-detect: key must be a Uint8Array or a CryptoKey');
  }
  if (
    algorithm.name !== 'HMAC' ||
    algorithm.hash?.name !== 'SHA-256' ||
    typeof algorithm.length !== 'number' ||
    algorithm.length < MIN_KEY_BYTES * 8 ||
    !usages.includes('sign')
  ) {
    throw new RangeError(
      `r-detect: key must be an HMAC-SHA256 signing key of at least ${MIN_KEY_BYTES * 8} bits`,
    );
  }
}

async function importKey(key: KeyInput): Promise<CryptoKey> {
  assertKey(key);
  if (!(key instanceof Uint8Array)) return key as CryptoKey;
  let pending = imported.get(key);
  if (!pending) {
    // Copied, so the imported key never shares memory with the caller's array.
    pending = crypto.subtle.importKey(
      'raw',
      new Uint8Array(key),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    imported.set(key, pending);
    pending.catch(() => imported.delete(key));
  }
  return pending;
}

/** Lowercase hex HMAC-SHA256 of the UTF-8 bytes of `message`. */
export async function hmacHex(key: KeyInput, message: string): Promise<string> {
  const signature = await crypto.subtle.sign(
    'HMAC',
    await importKey(key),
    new TextEncoder().encode(message),
  );
  return toHex(new Uint8Array(signature));
}
