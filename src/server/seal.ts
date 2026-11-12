import { DIGEST_PATTERN } from '../shared/hex.ts';
import { parseReading } from '../shared/parse.ts';
import { PART_KEYS, RECIPE, type PartKey, type Parts, type Reading } from '../shared/types.ts';
import { assertKey, hmacHex, type KeyInput } from './key.ts';
import { isPublicAddress, networkKey } from './network.ts';

/** A reading in the form meant for storage: keyed digests, plus the context scoring needs. */
export interface SealedReading {
  recipe: typeof RECIPE;
  /** Keyed part digests. Not comparable with the digests of an unsealed reading. */
  parts: Parts;
  battery: number | null;
  /** Keyed digest of the sender's network, or `null` when no valid address was given. */
  network: string | null;
  /** When the reading was sealed, in epoch milliseconds. Keep it a number when reading it back from storage. */
  at: number;
  /** The `keyId` given when sealing. Readings with different key ids are never compared. */
  keyId?: string;
}

export interface SealOptions {
  key: KeyInput;
  /**
   * The client's address as seen by your trusted edge. Used only to derive
   * `network`; never stored. Do not take it from a header the client can set.
   */
  ip?: string | null;
  /**
   * By default a loopback, private, link-local or carrier-internal address
   * gives `network: null`, because it is almost always a proxy's address and
   * would put every visitor on one network. Set `true` on a private network
   * where such addresses really are the clients'.
   */
  allowPrivateNetworks?: boolean;
  /**
   * A label for the key in use, stored with the reading. After a key change,
   * old and new readings carry different labels and `bestMatch` skips the
   * pair instead of reporting a mismatch.
   */
  keyId?: string;
  /** Epoch milliseconds. Default: `Date.now()`. */
  at?: number;
}

/**
 * Keyed digest of one part: lowercase hex HMAC-SHA256 of
 * `part:<part>:<clientDigest>`.
 */
export async function keyedDigest(
  key: KeyInput,
  part: PartKey,
  clientDigest: string,
): Promise<string> {
  if (!(PART_KEYS as readonly string[]).includes(part)) {
    throw new RangeError(`r-detect: unknown part ${String(part)}`);
  }
  if (typeof clientDigest !== 'string' || !DIGEST_PATTERN.test(clientDigest)) {
    throw new RangeError('r-detect: a digest is 64 lowercase hex characters');
  }
  return hmacHex(key, `part:${part}:${clientDigest}`);
}

/**
 * Turns a reading into the form to store and compare: every part digest is
 * re-hashed with a secret key, so that, as long as the key stays secret,
 * stored values cannot be matched against values computed outside your system.
 *
 * The returned promise rejects with `TypeError` when `reading` is not a valid
 * reading (pass the result of `parseReading`), and with `RangeError` when the
 * key is unusable.
 */
export async function sealReading(reading: Reading, options: SealOptions): Promise<SealedReading> {
  assertKey(options.key);
  const checked = parseReading(reading);
  if (checked === null) {
    throw new TypeError('r-detect: not a valid reading; pass the result of parseReading');
  }
  const entries = await Promise.all(
    PART_KEYS.flatMap((part) => {
      const digest = checked.parts[part];
      return digest === undefined
        ? []
        : [keyedDigest(options.key, part, digest).then((keyed) => [part, keyed] as const)];
    }),
  );
  const address =
    typeof options.ip === 'string' &&
    (options.allowPrivateNetworks === true || isPublicAddress(options.ip))
      ? options.ip
      : null;
  const sealed: SealedReading = {
    recipe: RECIPE,
    parts: Object.fromEntries(entries) as Parts,
    battery: checked.traits?.battery ?? null,
    network: address === null ? null : await networkKey(options.key, address),
    at: typeof options.at === 'number' && Number.isFinite(options.at) ? options.at : Date.now(),
  };
  if (typeof options.keyId === 'string') sealed.keyId = options.keyId;
  return sealed;
}
