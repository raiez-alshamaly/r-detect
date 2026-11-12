export {
  compare,
  pairContext,
  type Band,
  type CompareOptions,
  type CompareResult,
  type Context,
  type PairContext,
  type PartState,
  type Reason,
  type ReasonCode,
} from './score/compare.ts';
export {
  DEFAULT_BANDS,
  DEFAULT_LIMITS,
  DEFAULT_WEIGHTS,
  type Bands,
  type Limits,
  type Weights,
} from './score/defaults.ts';
export { resolveScoring, type Scoring, type ScoringOptions } from './score/resolve.ts';
export {
  HARDWARE_PARTS,
  PART_KEYS,
  RECIPE,
  SETTINGS_PARTS,
  type PartKey,
  type Parts,
} from './shared/types.ts';
