import { PART_KEYS, type PartKey } from '../shared/types.ts';
import {
  DEFAULT_BANDS,
  DEFAULT_LIMITS,
  DEFAULT_WEIGHTS,
  type Bands,
  type Limits,
  type Weights,
} from './defaults.ts';

export interface ScoringOptions {
  weights?: {
    parts?: Partial<Record<PartKey, number>>;
    penalties?: Partial<Record<PartKey, number>>;
    network?: number;
    battery?: number;
  };
  limits?: Partial<Limits>;
  bands?: Partial<Bands>;
}

export interface Scoring {
  weights: Weights;
  limits: Limits;
  bands: Bands;
}

function integer(name: string, value: number, min: number, max: number): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`r-detect: ${name} must be an integer from ${min} to ${max}, got ${value}`);
  }
  return value;
}

// Copies only the known keys, ignoring keys set to undefined.
function merge<T extends object>(defaults: T, overrides: Partial<T> | null | undefined): T {
  const merged = { ...defaults };
  if (overrides === undefined || overrides === null) return merged;
  for (const key of Object.keys(defaults) as (keyof T)[]) {
    const value = overrides[key];
    if (value !== undefined && value !== null) merged[key] = value as T[keyof T];
  }
  return merged;
}

/**
 * Merges the given options over the defaults and validates the result.
 * Throws `RangeError` on an invalid configuration.
 */
export function resolveScoring(options?: ScoringOptions | null): Scoring {
  const given = options ?? {};
  const weights: Weights = {
    parts: merge(DEFAULT_WEIGHTS.parts, given.weights?.parts),
    penalties: merge(DEFAULT_WEIGHTS.penalties, given.weights?.penalties),
    network: given.weights?.network ?? DEFAULT_WEIGHTS.network,
    battery: given.weights?.battery ?? DEFAULT_WEIGHTS.battery,
  };
  const limits = merge(DEFAULT_LIMITS, given.limits);
  const bands = merge(DEFAULT_BANDS, given.bands);

  for (const key of PART_KEYS) {
    integer(`weights.parts.${key}`, weights.parts[key], 0, 100);
    integer(`weights.penalties.${key}`, weights.penalties[key], 0, 100);
  }
  integer('weights.network', weights.network, 0, 100);
  integer('weights.battery', weights.battery, 0, 100);
  integer('limits.uncorroboratedCap', limits.uncorroboratedCap, 0, 100);
  integer('limits.batteryTolerance', limits.batteryTolerance, 0, 100);
  integer('limits.batteryWindowMinutes', limits.batteryWindowMinutes, 1, 1440);
  integer('limits.batteryMinHardware', limits.batteryMinHardware, 0, 100);
  integer('limits.networkCrowdMax', limits.networkCrowdMax, 0, 100_000);
  integer('bands.weak', bands.weak, 1, 100);
  integer('bands.similar', bands.similar, 1, 100);
  // 101 is allowed for `strong`: scores stop at 100, so it switches the band off.
  integer('bands.strong', bands.strong, 1, 101);
  if (!(bands.weak < bands.similar && bands.similar < bands.strong)) {
    throw new RangeError('r-detect: bands must satisfy weak < similar < strong');
  }
  // Otherwise the cap would not keep an uncorroborated pair out of the top band.
  if (limits.uncorroboratedCap >= bands.strong) {
    throw new RangeError('r-detect: limits.uncorroboratedCap must be below bands.strong');
  }
  return { weights, limits, bands };
}
