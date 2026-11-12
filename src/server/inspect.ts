import {
  PART_KEYS,
  TRAIT_KEYS,
  type PartKey,
  type Reading,
  type Traits,
} from '../shared/types.ts';
import { parseReading } from '../shared/parse.ts';

/**
 * A sign that a reading's own values do not fit together. Each has honest
 * causes as well as dishonest ones; see docs/scoring.md.
 */
export type Finding =
  | 'automation'
  | 'emulatorModel'
  | 'androidX86Platform'
  | 'androidDesktopGpu'
  | 'androidNoTouch'
  | 'androidFinePointer'
  | 'platformHintMismatch'
  | 'appleMobileMismatch'
  | 'repeatedDigest';

export interface Inspection {
  /** In the order of the {@link Finding} type. Empty when nothing stands out. */
  findings: Finding[];
  /** Parts the reading does not carry. */
  missing: PartKey[];
  /**
   * The reading lacks two or more of `gpuPixels`, `physScreen`, `glHardware`
   * and `osVersion` and is not an Apple mobile device (which exposes little by
   * design), or it carries no parts at all.
   * Such a reading matches almost nothing and should not be trusted to be distinct.
   */
  thin: boolean;
  /** Every available trait agrees that this is an iPhone or iPad. */
  appleMobile: boolean;
}

const APPLE_MOBILE_PLATFORMS = new Set(['iPhone', 'iPad', 'iPod']);
const DESKTOP_PLATFORM_HINTS = new Set(['windows', 'macos', 'linux', 'chrome os']);
const X86_PLATFORM = /x86|i686|i386|amd64|win/i;
const THIN_PARTS: readonly PartKey[] = ['gpuPixels', 'physScreen', 'glHardware', 'osVersion'];

type Known = { [K in keyof Traits]: Traits[K] };

const NO_TRAITS: Known = {
  battery: null,
  os: null,
  platform: null,
  gpuClass: null,
  touch: null,
  pointer: null,
  hover: null,
  webdriver: null,
  uaPlatform: null,
  emulatorModel: null,
};

// An iPad's desktop-mode browser reports a Mac user agent. A real Mac has no touch points.
const ipadAsMac = (t: Known) =>
  t.os === 'mac' && t.platform === 'MacIntel' && t.touch !== null && t.touch > 1;

function isAppleMobile(t: Known): boolean {
  const platform =
    t.platform !== null &&
    (APPLE_MOBILE_PLATFORMS.has(t.platform) ||
      (t.platform === 'MacIntel' && t.touch !== null && t.touch > 1));
  return (
    (t.os === 'ios' || ipadAsMac(t)) &&
    platform &&
    t.uaPlatform === null &&
    t.gpuClass === 'apple' &&
    t.touch !== null &&
    t.touch >= 1 &&
    t.pointer === 'coarse'
  );
}

// Claims to be an Apple mobile device while a trait says otherwise. Merely
// failing `isAppleMobile` is not enough: a trackpad or a hidden GPU is normal.
function appleMobileMismatch(t: Known): boolean {
  if (t.os !== 'ios' && !ipadAsMac(t)) return false;
  return (
    t.touch === 0 ||
    t.gpuClass === 'desktop' ||
    t.gpuClass === 'software' ||
    t.gpuClass === 'mobile' ||
    (t.os === 'ios' && t.uaPlatform !== null)
  );
}

/**
 * Checks a reading for internal contradictions and for missing evidence.
 * It never changes a score; what to do with a finding is the caller's decision.
 *
 * A rule fires only when every trait it reads is present. A missing trait is
 * unknown, not suspicious. An empty list is therefore not a clean bill: a
 * client that sends no traits, or consistent false ones, raises nothing.
 *
 * @throws TypeError when `reading` is not a valid reading.
 */
export function inspectReading(reading: Reading): Inspection {
  const checked = parseReading(reading);
  if (checked === null) {
    throw new TypeError('r-detect: not a valid reading; pass the result of parseReading');
  }
  // Only values that are actually present replace the "unknown" defaults.
  const t: Known = { ...NO_TRAITS };
  const given: Partial<Traits> = checked.traits ?? {};
  for (const key of TRAIT_KEYS) {
    const value = given[key];
    if (value !== undefined && value !== null) (t as Record<string, unknown>)[key] = value;
  }
  const android = t.os === 'android';
  const findings: Finding[] = [];

  if (t.webdriver === true) findings.push('automation');
  if (t.emulatorModel === true) findings.push('emulatorModel');
  if (android && t.platform !== null && X86_PLATFORM.test(t.platform)) {
    findings.push('androidX86Platform');
  }
  if (android && (t.gpuClass === 'desktop' || t.gpuClass === 'software')) {
    findings.push('androidDesktopGpu');
  }
  if (android && t.touch === 0) findings.push('androidNoTouch');
  if (android && t.pointer === 'fine' && t.hover === true) findings.push('androidFinePointer');
  // Browsers on iOS have no userAgentData at all, so any value there contradicts an iOS user agent.
  if (
    t.uaPlatform !== null &&
    ((android && DESKTOP_PLATFORM_HINTS.has(t.uaPlatform)) || t.os === 'ios')
  ) {
    findings.push('platformHintMismatch');
  }
  if (appleMobileMismatch(t)) findings.push('appleMobileMismatch');
  // The part name is inside every hash, so two parts can never share a digest.
  const digests = PART_KEYS.flatMap((key) => checked.parts[key] ?? []);
  if (new Set(digests).size !== digests.length) findings.push('repeatedDigest');

  const missing = PART_KEYS.filter((key) => checked.parts[key] === undefined);
  const appleMobile = isAppleMobile(t);
  return {
    findings,
    missing,
    thin:
      missing.length === PART_KEYS.length ||
      (!appleMobile && THIN_PARTS.filter((key) => missing.includes(key)).length >= 2),
    appleMobile,
  };
}
