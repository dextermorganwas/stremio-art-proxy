export interface ScorableImage {
  file_path: string;
  width: number;
  height: number;
  vote_average: number;
  vote_count: number;
  iso_639_1: string | null;
}

export type Confidence = 'good' | 'low' | 'none';

export interface SelectionResult<T> {
  image: T | null;
  confidence: Confidence;
}

/**
 * Selection logic (mirrors what you described):
 *  1. Hard-filter anything below the resolution floor - never negotiable.
 *  2. Starting at `floorStart` votes, keep only images with at least that
 *     many votes ("trustworthy enough that we stop caring about count"),
 *     and among those take the highest vote_average.
 *  3. If nothing has that many votes, step the floor down by `floorStep`
 *     and try again, down to `floorMin`.
 *  4. If even `floorMin` finds nothing, we no longer trust the vote data -
 *     fall back to "most-voted, then highest-average" and flag it 'low'
 *     confidence so the caller can decide whether to prefer Metahub instead.
 */
export function selectBestImage<T extends ScorableImage>(
  images: T[],
  minWidth: number,
  floorStart: number,
  floorMin: number,
  floorStep: number
): SelectionResult<T> {
  const eligible = images.filter((img) => img.width >= minWidth);
  if (eligible.length === 0) return { image: null, confidence: 'none' };

  for (let floor = floorStart; floor >= floorMin; floor -= floorStep) {
    const candidates = eligible.filter((img) => img.vote_count >= floor);
    if (candidates.length > 0) {
      candidates.sort(
        (a, b) => b.vote_average - a.vote_average || b.vote_count - a.vote_count || b.width - a.width
      );
      return { image: candidates[0], confidence: 'good' };
    }
  }

  const fallbackSorted = [...eligible].sort(
    (a, b) => b.vote_count - a.vote_count || b.vote_average - a.vote_average || b.width - a.width
  );
  return { image: fallbackSorted[0], confidence: 'low' };
}

/**
 * True if `a` should be preferred over `b` when comparing two already-chosen
 * "best of bracket" candidates against each other (e.g. English's best vs.
 * Original-language's best, when picking a fallback across brackets).
 */
export function isBetterCandidate<T extends ScorableImage>(a: T, b: T): boolean {
  if (a.vote_average !== b.vote_average) return a.vote_average > b.vote_average;
  if (a.vote_count !== b.vote_count) return a.vote_count > b.vote_count;
  return a.width > b.width;
}
