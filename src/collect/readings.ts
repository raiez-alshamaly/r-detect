// Browser reads other than WebGL and fonts. Each function either returns a
// value or throws; the caller guards every call.

import type { Traits } from '../shared/types.ts';
import { within } from './schedule.ts';
import { osFamily } from './values.ts';

const ASYNC_READ_LIMIT_MS = 1000;
const MAX_TEXT = 32;
const MAX_TOUCH = 256;

export function exposed<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

/** Reads a property of an unknown value without trusting its shape. */
export function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null
    ? exposed((): unknown => Reflect.get(value, key))
    : undefined;
}

function call(target: unknown, key: string, args: unknown[]): unknown {
  const method = field(target, key);
  if (typeof method !== 'function') throw new Error(key);
  return Reflect.apply(method, target, args) as unknown;
}

function media(query: string): boolean {
  return matchMedia(query).matches;
}

export function userAgent(): string {
  const value = exposed(() => navigator.userAgent);
  return typeof value === 'string' ? value : '';
}

/** `navigator.userAgentData` where the browser has it (Chromium), otherwise `undefined`. */
export function userAgentData(): unknown {
  return exposed(() => field(navigator, 'userAgentData'));
}

/** Battery charge as an integer 0-100, or `null` where the API is absent or slow. */
export async function battery(): Promise<number | null> {
  if (typeof field(navigator, 'getBattery') !== 'function') return null;
  const manager = await within(() => call(navigator, 'getBattery', []), ASYNC_READ_LIMIT_MS);
  const level = field(manager, 'level');
  return typeof level === 'number' && level >= 0 && level <= 1 ? Math.round(level * 100) : null;
}

/** High-entropy Client Hints: the device model and the platform version. */
export async function clientHints(): Promise<unknown> {
  const data = userAgentData();
  if (typeof field(data, 'getHighEntropyValues') !== 'function') return null;
  return within(
    () => call(data, 'getHighEntropyValues', [['model', 'platformVersion']]),
    ASYNC_READ_LIMIT_MS,
  );
}

export function darkMode(): 'dark' | 'light' {
  return media('(prefers-color-scheme: dark)') ? 'dark' : 'light';
}

/**
 * How the system formats a fixed date and a fixed number, plus the time zone
 * and hour cycle. The fixed inputs make the output depend only on settings.
 */
export function localeFormat(): [string | null, string, string, string | null] {
  const cycle = field(
    new Intl.DateTimeFormat(undefined, { hour: 'numeric' }).resolvedOptions(),
    'hourCycle',
  );
  return [
    Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
    new Date(Date.UTC(2020, 0, 2, 3, 4, 5)).toLocaleString(),
    (1234567.891).toLocaleString(),
    typeof cycle === 'string' ? cycle : null,
  ];
}

/** Audio output sample rate and channel count, display colour gamut and dynamic range. */
export function audioDisplay(): [number, number, string | null, string | null] {
  const Context: unknown = field(window, 'AudioContext') ?? field(window, 'webkitAudioContext');
  if (typeof Context !== 'function') throw new Error('AudioContext');
  const context: unknown = Reflect.construct(Context, []);
  try {
    const rate = field(context, 'sampleRate');
    const channels = field(field(context, 'destination'), 'maxChannelCount');
    if (typeof rate !== 'number' || typeof channels !== 'number') throw new Error('audio');
    const first = (feature: string, values: string[]) =>
      values.find((value) => media(`(${feature}: ${value})`)) ?? null;
    return [
      rate,
      channels,
      exposed(() => first('color-gamut', ['rec2020', 'p3', 'srgb'])) ?? null,
      exposed(() => first('dynamic-range', ['high', 'standard'])) ?? null,
    ];
  } finally {
    exposed(() => {
      void Promise.resolve(call(context, 'close', [])).catch(() => undefined);
    });
  }
}

/** The traits that need no waiting and no WebGL. */
export function quickTraits(): Pick<
  Traits,
  'os' | 'platform' | 'touch' | 'pointer' | 'hover' | 'webdriver' | 'uaPlatform'
> {
  const platform = exposed(() => navigator.platform);
  const touch = exposed(() => navigator.maxTouchPoints);
  const webdriver = field(exposed(() => navigator), 'webdriver');
  const data = userAgentData();
  const reported = field(data, 'platform');
  return {
    os: osFamily(userAgent()),
    platform: typeof platform === 'string' && platform ? platform.slice(0, MAX_TEXT) : null,
    touch:
      typeof touch === 'number' && Number.isInteger(touch) && touch >= 0
        ? Math.min(touch, MAX_TOUCH)
        : null,
    pointer:
      exposed(() =>
        (['coarse', 'fine', 'none'] as const).find((value) => media(`(pointer: ${value})`)),
      ) ?? null,
    hover: exposed(() => media('(hover: hover)')) ?? null,
    webdriver: typeof webdriver === 'boolean' ? webdriver : null,
    uaPlatform:
      typeof data === 'object' && data !== null && typeof reported === 'string'
        ? reported.toLowerCase().slice(0, MAX_TEXT)
        : null,
  };
}
