// Pure normalisers: text and numbers in, the value that gets hashed out. No DOM
// access, so every rule here is unit-tested in Node. Every expression in this
// file is part of recipe 1; changing one changes digests.

import type { GpuClass, OsFamily } from '../shared/types.ts';

// Renderer strings that name the browser instead of the graphics hardware.
const GENERIC_RENDERERS = ['Apple GPU', 'Mozilla', 'WebKit WebGL', 'WebKit'];

// Tested in this order. A mobile GPU that also names a desktop vendor is still
// a phone part, so `mobile` comes before `desktop`.
const GPU_CLASS_PATTERNS: readonly (readonly [GpuClass, RegExp])[] = [
  [
    'software',
    /swiftshader|llvmpipe|softpipe|virgl|virtualbox|vmware|microsoft basic render|android emulator|opengl es translator|basic render driver/i,
  ],
  ['mobile', /mali|adreno|powervr|xclipse|immortalis|maleoon|img |tegra|videocore/i],
  ['desktop', /nvidia|geforce|quadro|radeon|amd|intel|iris|uhd graphics|hd graphics/i],
  ['apple', /apple gpu|apple m|apple a/i],
];

const OS_PATTERNS: readonly (readonly [OsFamily, RegExp])[] = [
  ['android', /Android/],
  ['ios', /iPhone|iPad|iPod/],
  ['windows', /Windows/],
  ['cros', /CrOS/],
  ['mac', /Macintosh|Mac OS X/],
  ['linux', /Linux/],
];

const EMULATOR_MODEL =
  /sdk_gphone|android sdk built for|^generic|google_sdk|emulator|vmos|vphone|x8 sandbox|twoyi|ldplayer|bluestacks|\bnox\b|\bmemu\b|\bmumu\b/i;

/** True when the renderer string says nothing about the hardware. */
export function isHiddenRenderer(raw: string | undefined, braveNavigator: boolean): boolean {
  return braveNavigator || GENERIC_RENDERERS.includes(raw?.trim() ?? '');
}

/**
 * The GPU model with the wrapper, driver and API text removed, so two browsers
 * that describe one GPU differently produce the same value.
 * `ANGLE (ARM, Mali-G57 MC2, OpenGL ES 3.2)` and `Mali-G57 MC2` both give `mali-g57 mc2`.
 */
export function rendererModel(raw: string | undefined, hidden: boolean): string | null {
  if (raw === undefined || hidden) return null;
  let value = raw.trim();
  if (/^ANGLE \(/i.test(value)) {
    value = value.replace(/^ANGLE \(\s*/i, '').replace(/^[^,]*,\s*/i, '');
  }
  value = value
    .replace(/\s+Direct3D.*$/i, '')
    .replace(/,\s*OpenGL ES.*$/i, '')
    .replace(/\s+vs_.*$/i, '')
    .replace(/\s*\(0x[0-9a-f]+\)\s*$/i, '')
    .trim();
  const count = (mark: string) => value.split(mark).length;
  if (value.endsWith(')') && count(')') > count('(')) value = value.slice(0, -1);
  value = value.replace(/\s+/g, ' ').trim().toLowerCase();
  return value || null;
}

export function gpuClass(raw: string | undefined, hidden: boolean): GpuClass | null {
  if (raw === undefined) return null;
  const found = GPU_CLASS_PATTERNS.find(([, pattern]) => pattern.test(raw));
  return found ? found[0] : hidden ? 'hidden' : 'other';
}

/**
 * Physical pixels of the screen, each side rounded to a multiple of 8 and the
 * pair sorted. Browsers on one phone report different CSS sizes and ratios for
 * the same panel; the product is stable.
 */
export function physScreen(width: number, height: number, ratio: number): [number, number] | null {
  if (!(width > 0 && height > 0 && ratio > 0)) return null;
  const side = (value: number) => Math.round((value * ratio) / 8) * 8;
  const a = side(width);
  const b = side(height);
  return a <= b ? [a, b] : [b, a];
}

/** Client Hints model when present, otherwise the model token of an Android user agent. */
export function deviceModel(reported: unknown, userAgent: string): string | null {
  if (typeof reported === 'string' && reported.trim()) return reported.trim().toLowerCase();
  const found = /Android [^;)]*; ([^;)]+?)(?: Build\/|\))/i.exec(userAgent)?.[1];
  const value = found?.trim().toLowerCase();
  // Reduced user agents carry the placeholder model "K".
  return value && value !== 'k' ? value : null;
}

export function emulatorModel(model: string | null): boolean | null {
  return model === null ? null : EMULATOR_MODEL.test(model);
}

/** Major OS version as `android:16`, `ios:19` or `windows:15`. */
export function osVersion(userAgent: string, platform: unknown, version: unknown): string | null {
  const major = (value: unknown) =>
    typeof value === 'string' ? /^(\d+)/.exec(value)?.[1] : undefined;
  const android =
    (platform === 'Android' ? major(version) : undefined) ?? /Android (\d+)/.exec(userAgent)?.[1];
  if (android !== undefined) return `android:${Number(android)}`;
  const ios = /OS (\d+)_/.exec(userAgent)?.[1];
  if (ios !== undefined) return `ios:${Number(ios)}`;
  const windows = platform === 'Windows' ? major(version) : undefined;
  return windows !== undefined ? `windows:${Number(windows)}` : null;
}

export function osFamily(userAgent: string): OsFamily {
  return OS_PATTERNS.find(([, pattern]) => pattern.test(userAgent))?.[0] ?? 'other';
}
