import { compare, pairContext, type CompareOptions, type CompareResult } from '../score/compare.ts';
import { resolveScoring } from '../score/resolve.ts';
import type { SealedReading } from './seal.ts';

export type BestMatchOptions = Omit<CompareOptions, 'context'>;

export interface Match<T extends SealedReading> {
  candidate: T;
  /** Position of the candidate in the list that was passed in. */
  index: number;
  result: CompareResult;
}

export interface BestMatch<T extends SealedReading> {
  /** The highest-scoring candidate, or `null` when none could be compared. */
  best: Match<T> | null;
  /** How many candidates share the current reading's network. */
  networkCrowd: number;
  /** `false` when the network was too crowded to count as evidence. */
  networkCounted: boolean;
}

/**
 * Compares one reading with a list of earlier ones and returns the closest.
 *
 * Network agreement only counts while the network is quiet: when more than
 * `limits.networkCrowdMax` candidates share the current network (a carrier
 * gateway, an office, a campus), being on it says little about being the same
 * device, so it is left out for every candidate.
 *
 * Pass one candidate per earlier browser or session. Repeated readings of one
 * device would otherwise crowd its own network. Candidates sealed with a
 * different recipe or a different `keyId` are skipped. The work is linear in the number of
 * candidates; narrow the list (by time, by scope) before calling.
 *
 * Ties go to the corroborated match, then to the more recent candidate, then
 * to the earlier position.
 *
 * @throws RangeError when the options describe an invalid configuration.
 */
export function bestMatch<T extends SealedReading>(
  current: SealedReading,
  candidates: readonly T[],
  options?: BestMatchOptions | null,
): BestMatch<T> {
  const { limits } = resolveScoring(options);
  // Another recipe or another key means the digests live in different spaces.
  const comparable = (candidate: T) =>
    typeof candidate === 'object' &&
    candidate !== null &&
    candidate.recipe === current.recipe &&
    candidate.keyId === current.keyId;
  const networkCrowd =
    typeof current.network === 'string' && current.network !== ''
      ? candidates.filter((candidate) => comparable(candidate) && candidate.network === current.network)
          .length
      : 0;
  const networkCounted = networkCrowd <= limits.networkCrowdMax;

  let best: Match<T> | null = null;
  for (const [index, candidate] of candidates.entries()) {
    if (!comparable(candidate)) continue;
    const context = pairContext(current, candidate);
    if (!networkCounted) context.sameNetwork = false;
    const result = compare(current.parts, candidate.parts, { ...options, context });
    if (best === null || beats(result, candidate, best)) best = { candidate, index, result };
  }
  return { best, networkCrowd, networkCounted };
}

// A candidate without a usable time counts as the oldest.
const recency = (reading: SealedReading): number =>
  typeof reading.at === 'number' && Number.isFinite(reading.at) ? reading.at : -Infinity;

function beats<T extends SealedReading>(result: CompareResult, candidate: T, best: Match<T>): boolean {
  if (result.score !== best.result.score) return result.score > best.result.score;
  if (result.corroborated !== best.result.corroborated) return result.corroborated;
  return recency(candidate) > recency(best.candidate);
}
