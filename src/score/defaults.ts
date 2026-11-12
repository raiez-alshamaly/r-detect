import type { PartKey } from '../shared/types.ts';

export interface Weights {
  /** Points added when a part is equal on both sides. */
  parts: Record<PartKey, number>;
  /** Points removed when a part is present on both sides and differs. */
  penalties: Record<PartKey, number>;
  /** Points added when both readings came from the same network. */
  network: number;
  /** Points added when the battery levels agree within the limits below. */
  battery: number;
}

export interface Limits {
  /** Highest score a pair can reach on device parts alone, with no network or battery agreement. */
  uncorroboratedCap: number;
  /** Largest battery difference, in points of charge, that still counts as agreement. */
  batteryTolerance: number;
  /** Longest time between two readings for their battery levels to be compared. */
  batteryWindowMinutes: number;
  /** Matched hardware points a pair needs before battery agreement counts. */
  batteryMinHardware: number;
  /** `bestMatch` only: above this many candidates on one network, the network proves nothing. */
  networkCrowdMax: number;
}

export interface Bands {
  weak: number;
  similar: number;
  strong: number;
}

/**
 * Part weights are log-likelihood ratios measured on a field deployment
 * (1,217 browsers): how much more often a part is equal for the same device
 * than for two different ones, scaled so the ten parts total 72.
 * See docs/scoring.md for the measurements behind each number.
 */
export const DEFAULT_WEIGHTS: Weights = Object.freeze({
  parts: Object.freeze({
    gpuPixels: 8,
    glHardware: 6,
    physScreen: 9,
    model: 19,
    osVersion: 8,
    rendererModel: 10,
    darkMode: 2,
    localeFormat: 7,
    fonts: 2,
    audioDisplay: 1,
  }),
  penalties: Object.freeze({
    gpuPixels: 10,
    glHardware: 0,
    physScreen: 6,
    model: 6,
    osVersion: 0,
    rendererModel: 0,
    darkMode: 0,
    localeFormat: 0,
    fonts: 0,
    audioDisplay: 0,
  }),
  network: 20,
  battery: 8,
});

export const DEFAULT_LIMITS: Limits = Object.freeze({
  uncorroboratedCap: 79,
  batteryTolerance: 2,
  batteryWindowMinutes: 15,
  batteryMinHardware: 40,
  networkCrowdMax: 3,
});

export const DEFAULT_BANDS: Bands = Object.freeze({ weak: 30, similar: 55, strong: 80 });
