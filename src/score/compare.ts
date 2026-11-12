import {
  HARDWARE_PARTS,
  PART_KEYS,
  SETTINGS_PARTS,
  type PartKey,
  type Parts,
} from '../shared/types.ts';
import { resolveScoring, type ScoringOptions } from './resolve.ts';

/** What the server knows about one reading, apart from its parts. */
export interface Context {
  /** Opaque network identifier, for example the output of `networkKey`. Only equality matters. */
  network?: string | null;
  /** Battery charge, 0-100, as reported in the reading's traits. */
  battery?: number | null;
  /** When the reading was received, in epoch milliseconds on the server clock. */
  at?: number | null;
}

/** The three facts about a pair of readings that scoring uses. */
export interface PairContext {
  sameNetwork?: boolean;
  /** Absolute difference between the two battery levels. */
  batteryDelta?: number | null;
  /** Absolute time between the two readings. */
  minutesApart?: number | null;
}

export interface CompareOptions extends ScoringOptions {
  /**
   * `'full'` (default) compares all ten parts. `'crossBrowser'` leaves out
   * `darkMode`, `localeFormat` and `audioDisplay`, which differ between
   * browsers on the same device.
   */
  mode?: 'full' | 'crossBrowser';
  context?: PairContext;
}

export type Band = 'none' | 'weak' | 'similar' | 'strong';
export type PartState = 'match' | 'mismatch' | 'missing' | 'ignored';

export type ReasonCode =
  | `match.${PartKey}`
  | `mismatch.${PartKey}`
  | 'floor.zero'
  | 'context.network'
  | 'context.battery'
  | 'cap.uncorroborated'
  | 'cap.max';

/** One line of the score's breakdown. `points` is negative for penalties and caps. */
export interface Reason {
  code: ReasonCode;
  points: number;
}

export interface CompareResult {
  /** Integer from 0 to 100. The sum of `reasons[].points`. */
  score: number;
  band: Band;
  /** Whether network or battery agreement backed up the device parts. */
  corroborated: boolean;
  /** Points from matching hardware parts. */
  hardware: number;
  /** Points from matching settings parts. */
  settings: number;
  /**
   * Share of the available evidence that could be compared, from 0 to 1: the
   * weight of the parts present on both sides over the weight of all parts in
   * the chosen mode. A low score with low coverage means "could not tell".
   */
  coverage: number;
  parts: Record<PartKey, PartState>;
  reasons: Reason[];
}

const CROSS_BROWSER_IGNORED: ReadonlySet<PartKey> = new Set(['darkMode', 'localeFormat', 'audioDisplay']);
const NOTHING_IGNORED: ReadonlySet<PartKey> = new Set();
const HARDWARE: ReadonlySet<PartKey> = new Set(HARDWARE_PARTS);
const SETTINGS: ReadonlySet<PartKey> = new Set(SETTINGS_PARTS);

/** Reduces what is known about two readings to the pair-level facts `compare` takes. */
export function pairContext(a: Context, b: Context): PairContext {
  const known = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value);
  return {
    sameNetwork:
      typeof a.network === 'string' && a.network !== '' && a.network === b.network,
    // Two full batteries are not agreement: phones left on charge all read 100.
    batteryDelta:
      known(a.battery) && known(b.battery) && !(a.battery === 100 && b.battery === 100)
        ? Math.abs(a.battery - b.battery)
        : null,
    minutesApart: known(a.at) && known(b.at) ? Math.abs(a.at - b.at) / 60_000 : null,
  };
}

/**
 * Scores how likely two sets of part digests come from the same device.
 *
 * Equal parts add their weight. A part that differs subtracts its penalty.
 * A part missing on either side changes nothing. Without network or battery
 * agreement the score stops at `limits.uncorroboratedCap`: many devices of one
 * model are identical on every part, so the parts alone never prove identity.
 *
 * Both inputs must be in the same digest space: either both straight from
 * `collect()`, or both keyed with the same key. A mix compares as all
 * mismatches.
 *
 * @throws RangeError when the options describe an invalid configuration.
 */
export function compare(a: Parts, b: Parts, options?: CompareOptions | null): CompareResult {
  const { weights, limits, bands } = resolveScoring(options);
  const mode = options?.mode ?? 'full';
  if (mode !== 'full' && mode !== 'crossBrowser') {
    throw new RangeError(`r-detect: mode must be 'full' or 'crossBrowser', got ${String(mode)}`);
  }
  const ignored = mode === 'crossBrowser' ? CROSS_BROWSER_IGNORED : NOTHING_IGNORED;
  const context = options?.context ?? {};

  const states = {} as Record<PartKey, PartState>;
  const reasons: Reason[] = [];
  let matched = 0;
  let penalty = 0;
  let hardware = 0;
  let settings = 0;
  let comparable = 0;
  let available = 0;

  for (const key of PART_KEYS) {
    if (ignored.has(key)) {
      states[key] = 'ignored';
      continue;
    }
    const weight = weights.parts[key];
    available += weight;
    const left: unknown = a?.[key];
    const right: unknown = b?.[key];
    if (typeof left !== 'string' || typeof right !== 'string' || left === '' || right === '') {
      states[key] = 'missing';
      continue;
    }
    comparable += weight;
    if (left === right) {
      states[key] = 'match';
      matched += weight;
      if (HARDWARE.has(key)) hardware += weight;
      if (SETTINGS.has(key)) settings += weight;
      if (weight > 0) reasons.push({ code: `match.${key}`, points: weight });
    } else {
      states[key] = 'mismatch';
      const cost = weights.penalties[key];
      penalty += cost;
      if (cost > 0) reasons.push({ code: `mismatch.${key}`, points: -cost });
    }
  }

  const device = Math.max(0, matched - penalty);
  if (matched - penalty < 0) reasons.push({ code: 'floor.zero', points: penalty - matched });

  const network = context.sameNetwork === true ? weights.network : 0;
  if (network > 0) reasons.push({ code: 'context.network', points: network });

  const batteryAgrees =
    typeof context.batteryDelta === 'number' &&
    context.batteryDelta >= 0 &&
    context.batteryDelta <= limits.batteryTolerance &&
    typeof context.minutesApart === 'number' &&
    context.minutesApart >= 0 &&
    context.minutesApart <= limits.batteryWindowMinutes &&
    hardware >= limits.batteryMinHardware;
  const battery = batteryAgrees ? weights.battery : 0;
  if (battery > 0) reasons.push({ code: 'context.battery', points: battery });

  const corroborated = network > 0 || battery > 0;
  const raw = device + network + battery;
  const ceiling = corroborated ? 100 : Math.min(100, limits.uncorroboratedCap);
  const score = Math.min(raw, ceiling);
  if (raw > ceiling) {
    reasons.push({ code: corroborated ? 'cap.max' : 'cap.uncorroborated', points: ceiling - raw });
  }

  return {
    score,
    band:
      score >= bands.strong
        ? 'strong'
        : score >= bands.similar
          ? 'similar'
          : score >= bands.weak
            ? 'weak'
            : 'none',
    corroborated,
    hardware,
    settings,
    coverage: available > 0 ? Math.round((comparable / available) * 100) / 100 : 0,
    parts: states,
    reasons,
  };
}
