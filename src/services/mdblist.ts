import { config } from '../config';
import { fetchWithTimeout } from './httpQueue';
import { logger } from '../logger';

/**
 * Accepts either a full list URL (https://mdblist.com/lists/username/slug)
 * or just the "username/slug" part, and normalizes to "username/slug".
 * Also strips a trailing slash or query string if someone pastes the URL
 * with one attached.
 */
function extractListPath(listRef: string): string | null {
  const trimmed = listRef.trim();
  const urlMatch = trimmed.match(/mdblist\.com\/lists\/([^/?#]+\/[^/?#]+)/i);
  if (urlMatch) return urlMatch[1];
  if (/^[^/\s]+\/[^/\s]+$/.test(trimmed)) return trimmed;
  return null;
}

/**
 * MDBList exposes a public, no-API-key JSON endpoint for public lists:
 * https://mdblist.com/lists/{username}/{slug}/json - this is what several
 * third-party apps use instead of the key-gated REST API, and doesn't
 * require MDBLIST_API_KEY at all for public lists.
 */
export async function fetchMdblistTmdbIds(listRef: string): Promise<string[]> {
  if (!listRef) return [];
  const path = extractListPath(listRef);
  if (!path) {
    logger.warn('[mdblist] could not parse list reference, expected a full mdblist.com/lists/... URL or "username/slug"', listRef);
    return [];
  }

  const url = config.mdblistListEndpointTemplate
    .replace('{list}', path)
    .replace('{apikey}', config.mdblistApiKey);

  try {
    const res = await fetchWithTimeout(url, config.requestTimeoutMs);
    if (!res.ok) {
      logger.warn('[mdblist] request failed', url, res.status);
      return [];
    }
    const data = (await res.json()) as any;
    const items: any[] = Array.isArray(data) ? data : data.items || data.movies || data.shows || [];
    return items
      .map((item) => item.tmdbid ?? item.tmdb_id ?? item.ids?.tmdb)
      .filter((id) => id !== undefined && id !== null)
      .map(String);
  } catch (err) {
    logger.warn('[mdblist] fetch failed', url, err);
    return [];
  }
}
