import {
  PART_KEYS,
  RECIPE,
  TRAIT_KEYS,
  type PartKey,
  type Parts,
  type Reading,
  type ReadingStatus,
  type Timings,
  type TraitKey,
  type Traits,
} from '../shared/types.ts';
import { fonts } from './fonts.ts';
import { glHardware, readContext, rendererString } from './gl.ts';
import { drawGpuPixels } from './gpuPixels.ts';
import { hasSubtle, partDigest, sha256Hex } from './hash.ts';
import {
  audioDisplay,
  battery,
  clientHints,
  darkMode,
  exposed,
  field,
  localeFormat,
  quickTraits,
  userAgent,
  userAgentData,
} from './readings.ts';
import { afterPaint, yieldTask } from './schedule.ts';
import {
  deviceModel,
  emulatorModel,
  gpuClass,
  isHiddenRenderer,
  osVersion,
  physScreen,
  rendererModel,
} from './values.ts';

export interface CollectOptions {
  /** Parts to read. Default: all ten. A part that is not listed is not read at all. */
  parts?: readonly PartKey[];
  /** `false` reads no traits; an array reads only those. Default: all ten. */
  traits?: boolean | readonly TraitKey[];
  /**
   * `'idle'` (default) waits for the next paint and for idle time before
   * reading. `'now'` starts immediately, for callers that already run late.
   */
  schedule?: 'idle' | 'now';
  /** Upper bound for the whole read, waiting included. Default 20000, clamped to 1000-60000. */
  timeoutMs?: number;
  /** Adds per-step durations to the reading. Default `false`. */
  timings?: boolean;
}

const DEFAULT_TIMEOUT_MS = 20_000;
const MIN_TIMEOUT_MS = 1000;
const MAX_TIMEOUT_MS = 60_000;

function selected<K extends string>(all: readonly K[], chosen: unknown): Set<K> {
  if (!Array.isArray(chosen)) return new Set(all);
  return new Set(all.filter((key) => chosen.includes(key)));
}

function timeoutOf(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_TIMEOUT_MS;
  return Math.min(MAX_TIMEOUT_MS, Math.max(MIN_TIMEOUT_MS, Math.round(value)));
}

const QUICK_TRAITS: readonly TraitKey[] = [
  'os',
  'platform',
  'touch',
  'pointer',
  'hover',
  'webdriver',
  'uaPlatform',
];

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/**
 * Reads the device signals a page can see without a permission prompt and
 * returns them as a {@link Reading}: one SHA-256 digest per part, plus plain
 * traits.
 *
 * The promise always resolves and never rejects. A part the browser does not
 * expose is left out; that is not an error. Outside a browser, or in a context
 * without `crypto.subtle`, the reading has status `'unsupported'` and no parts.
 *
 * Each call reads everything again, so one call per page load is enough. To
 * prepare early and use the result later, keep the promise:
 *
 * ```ts
 * const pending = collect();          // at page start
 * const reading = await pending;      // when the reading is needed
 * ```
 */
export function collect(options?: CollectOptions | null): Promise<Reading> {
  // Options are read once, up front. Anything unusable falls back to the default.
  let given: CollectOptions = {};
  try {
    const { parts, traits, schedule, timeoutMs, timings } = options ?? {};
    given = { parts, traits, schedule, timeoutMs, timings };
  } catch {
    // An options object that throws on access is treated as no options.
  }
  const wantParts = selected(PART_KEYS, given.parts);
  const wantTraits =
    given.traits === false ? new Set<TraitKey>() : selected(TRAIT_KEYS, given.traits);
  const withTimings = given.timings === true;
  const timeoutMs = timeoutOf(given.timeoutMs);
  const wantsQuickTraits = QUICK_TRAITS.some((key) => wantTraits.has(key));

  const parts: Parts = {};
  const traits: Partial<Record<TraitKey, Traits[TraitKey]>> = {};
  for (const key of wantTraits) traits[key] = null;
  const timings: Timings = {};

  const build = (status: ReadingStatus, total: number): Reading => {
    const reading: Reading = { recipe: RECIPE, status, parts: { ...parts } };
    if (wantTraits.size > 0) reading.traits = { ...traits } as Partial<Traits>;
    if (withTimings) reading.timings = { ...timings, total: Math.round(total) };
    return reading;
  };

  if (
    typeof window === 'undefined' ||
    typeof document === 'undefined' ||
    typeof navigator === 'undefined'
  ) {
    return Promise.resolve(build('unsupported', 0));
  }

  return new Promise<Reading>((resolve) => {
    const started = now();
    let settled = false;
    const finish = (status: ReadingStatus) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(build(status, now() - started));
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);

    const setTrait = <K extends TraitKey>(key: K, value: Traits[K]) => {
      if (wantTraits.has(key)) traits[key] = value;
    };
    const timed = (key: keyof Timings, since: number) => {
      timings[key] = Math.round(now() - since);
    };

    // Reads one part and stores its digest. A read that throws, or returns
    // null or undefined, leaves the part out.
    const put = async (key: PartKey, read: () => unknown) => {
      if (settled || !wantParts.has(key)) return;
      const since = now();
      try {
        const value = await read();
        if (value !== undefined && value !== null) {
          const digest = await partDigest(key, value);
          if (!settled) parts[key] = digest;
        }
      } catch {
        // One unreadable part leaves the others.
      }
      timed(key, since);
    };

    const work = async (): Promise<ReadingStatus> => {
      const sinceTraits = now();
      const quick = wantsQuickTraits ? exposed(quickTraits) : undefined;
      if (quick) {
        for (const key of Object.keys(quick) as (keyof typeof quick)[]) setTrait(key, quick[key]);
      }
      timed('traits', sinceTraits);

      if (!hasSubtle()) return 'unsupported';

      const needsContext =
        wantParts.has('glHardware') || wantParts.has('rendererModel') || wantTraits.has('gpuClass');
      const gl = needsContext ? (exposed(readContext) ?? null) : null;
      const raw = gl ? exposed(() => rendererString(gl)) : undefined;
      const hidden = isHiddenRenderer(raw, exposed(() => 'brave' in navigator) === true);
      setTrait('gpuClass', gpuClass(raw, hidden));

      await put('glHardware', () => (gl ? glHardware(gl) : undefined));
      await put('physScreen', () => physScreen(screen.width, screen.height, window.devicePixelRatio));
      await put('rendererModel', () => rendererModel(raw, hidden));
      await put('darkMode', darkMode);
      await put('localeFormat', localeFormat);

      // Started now, awaited last: both can take up to a second.
      const batteryPending = wantTraits.has('battery') ? battery().catch(() => null) : null;
      const needsHints =
        wantParts.has('model') || wantParts.has('osVersion') || wantTraits.has('emulatorModel');
      const hintsPending = needsHints ? clientHints().catch(() => null) : null;

      // Each heavier read gets its own task, so input in between is not held up.
      if (wantParts.has('fonts')) {
        await yieldTask();
        await put('fonts', () => fonts(() => settled));
      }
      if (wantParts.has('audioDisplay')) {
        await yieldTask();
        await put('audioDisplay', audioDisplay);
      }
      if (wantParts.has('gpuPixels')) {
        await yieldTask();
        await put('gpuPixels', () => {
          const pixels = drawGpuPixels();
          return pixels ? sha256Hex(pixels) : undefined;
        });
      }

      if (batteryPending) setTrait('battery', await batteryPending);
      if (hintsPending) {
        const hints = await hintsPending;
        const agent = userAgent();
        const model = deviceModel(field(hints, 'model'), agent);
        await put('model', () => model);
        await put('osVersion', () =>
          osVersion(agent, field(userAgentData(), 'platform'), field(hints, 'platformVersion')),
        );
        setTrait('emulatorModel', emulatorModel(model));
      }
      return 'ok';
    };

    let begun = false;
    const begin = () => {
      if (begun) return;
      begun = true;
      timings.wait = Math.round(now() - started);
      if (settled) return;
      // Every read inside `work` is guarded, so a rejection is not expected;
      // if one happens, what was read so far is still returned.
      void work().then(finish, () => finish('ok'));
    };

    try {
      if (given.schedule === 'now') queueMicrotask(begin);
      else afterPaint(begin);
    } catch {
      begin();
    }
  });
}
