/**
 * Version of the hashing recipe. A reading's digests are only comparable with
 * digests produced by the same recipe.
 */
export const RECIPE = 1;

export const HARDWARE_PARTS = [
  'gpuPixels',
  'glHardware',
  'physScreen',
  'model',
  'osVersion',
  'rendererModel',
] as const;

export const SETTINGS_PARTS = ['darkMode', 'localeFormat', 'fonts', 'audioDisplay'] as const;

export const PART_KEYS = [...HARDWARE_PARTS, ...SETTINGS_PARTS] as const;

export type PartKey = (typeof PART_KEYS)[number];

/** One 64-character lowercase hex digest per readable part. An absent key means "not readable". */
export type Parts = Partial<Record<PartKey, string>>;

export const OS_FAMILIES = ['android', 'ios', 'windows', 'mac', 'linux', 'cros', 'other'] as const;
export const GPU_CLASSES = ['software', 'desktop', 'mobile', 'apple', 'hidden', 'other'] as const;
export const POINTER_KINDS = ['coarse', 'fine', 'none'] as const;

export type OsFamily = (typeof OS_FAMILIES)[number];
export type GpuClass = (typeof GPU_CLASSES)[number];
export type PointerKind = (typeof POINTER_KINDS)[number];

/** Plain values that are compared, never hashed. `null` means unknown. */
export interface Traits {
  /** Battery charge, integer 0-100. */
  battery: number | null;
  os: OsFamily | null;
  /** `navigator.platform`, at most 32 characters. */
  platform: string | null;
  gpuClass: GpuClass | null;
  /** `navigator.maxTouchPoints`. */
  touch: number | null;
  pointer: PointerKind | null;
  hover: boolean | null;
  webdriver: boolean | null;
  /** `navigator.userAgentData.platform`, lowercased, at most 32 characters. */
  uaPlatform: string | null;
  /** Whether the model name looks like an emulator. The model text itself is never included. */
  emulatorModel: boolean | null;
}

export const TRAIT_KEYS = [
  'battery',
  'os',
  'platform',
  'gpuClass',
  'touch',
  'pointer',
  'hover',
  'webdriver',
  'uaPlatform',
  'emulatorModel',
] as const satisfies readonly (keyof Traits)[];

export type TraitKey = keyof Traits;

export type ReadingStatus = 'ok' | 'timeout' | 'unsupported';

/** Whole milliseconds spent per step. Present only when requested. */
export type Timings = Partial<Record<PartKey | 'traits' | 'wait' | 'total', number>>;

/** What `collect()` returns. Plain JSON: `JSON.stringify(reading)` is the wire format. */
export interface Reading {
  recipe: typeof RECIPE;
  status: ReadingStatus;
  parts: Parts;
  /** Absent when traits are switched off. */
  traits?: Partial<Traits>;
  timings?: Timings;
}
