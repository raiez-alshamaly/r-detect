import { DIGEST_PATTERN } from './hex.ts';
import {
  GPU_CLASSES,
  OS_FAMILIES,
  PART_KEYS,
  POINTER_KINDS,
  RECIPE,
  type Parts,
  type Reading,
  type ReadingStatus,
  type Traits,
} from './types.ts';

const STATUSES: readonly ReadingStatus[] = ['ok', 'timeout', 'unsupported'];
const MAX_TEXT = 32;
const MAX_TOUCH = 256;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const own = (record: Record<string, unknown>, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(record, key) ? record[key] : undefined;

const oneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === 'string' && (list as readonly string[]).includes(value);

type Check<T> = (value: unknown) => T | undefined;

// Free text from the client: cut to length and reduced to characters that are
// safe to log and display.
const text: Check<string> = (value) =>
  typeof value === 'string' ? value.slice(0, MAX_TEXT).replace(/[^\w .:/()-]/g, '') : undefined;
const lowerText: Check<string> = (value) => text(value)?.toLowerCase();
const flag: Check<boolean> = (value) => (typeof value === 'boolean' ? value : undefined);
const integer =
  (max: number): Check<number> =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= max
      ? value
      : undefined;
const member =
  <T extends string>(list: readonly T[]): Check<T> =>
  (value) =>
    oneOf(list, value) ? value : undefined;

const traitChecks: { [K in keyof Traits]: Check<NonNullable<Traits[K]>> } = {
  battery: integer(100),
  os: member(OS_FAMILIES),
  platform: text,
  gpuClass: member(GPU_CLASSES),
  touch: integer(MAX_TOUCH),
  pointer: member(POINTER_KINDS),
  hover: flag,
  webdriver: flag,
  uaPlatform: lowerText,
  emulatorModel: flag,
};

function parseParts(input: unknown): Parts | null {
  if (!isRecord(input)) return null;
  const known = new Set<string>(PART_KEYS);
  for (const key of Object.keys(input)) if (!known.has(key)) return null;
  const parts: Parts = {};
  for (const key of PART_KEYS) {
    const value = own(input, key);
    if (value === undefined) continue;
    if (typeof value !== 'string' || !DIGEST_PATTERN.test(value)) return null;
    parts[key] = value;
  }
  return parts;
}

function parseTraits(input: unknown): Partial<Traits> | null {
  if (!isRecord(input)) return null;
  const traits: Record<string, unknown> = {};
  for (const key of Object.keys(traitChecks) as (keyof Traits)[]) {
    const value = own(input, key);
    if (value === undefined) continue;
    if (value === null) {
      traits[key] = null;
      continue;
    }
    const checked = traitChecks[key](value);
    if (checked === undefined) return null;
    traits[key] = checked;
  }
  return traits as Partial<Traits>;
}

/**
 * Validates untrusted JSON as a reading. Returns a fresh object holding only
 * known fields, or `null` when the shape is wrong. Never throws.
 *
 * Unknown part keys and malformed digests reject the whole reading. Unknown
 * trait keys and `timings` are dropped.
 */
export function parseReading(input: unknown): Reading | null {
  try {
    if (!isRecord(input)) return null;
    if (own(input, 'recipe') !== RECIPE) return null;
    const status = own(input, 'status');
    if (!oneOf(STATUSES, status)) return null;
    const parts = parseParts(own(input, 'parts'));
    if (parts === null) return null;
    const reading: Reading = { recipe: RECIPE, status, parts };
    const rawTraits = own(input, 'traits');
    if (rawTraits !== undefined) {
      const traits = parseTraits(rawTraits);
      if (traits === null) return null;
      reading.traits = traits;
    }
    return reading;
  } catch {
    return null;
  }
}
