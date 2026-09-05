import { config } from '../config';
import { fetchWithTimeout } from './httpQueue';
import { logger } from '../logger';

/**
 * MDBList's exact REST shape isn't fully published, so this is built from
 * publicly observable patterns (their list URLs are mdblist.com/lists/{user}/{slug},
 * their API base is api.mdblist.com, auth is an apikey query param). If this
 * doesn't work against your key, check the warning this logs (it includes the
 * URL and status code) against https://docs.mdblist.com and correct
 * MDBLIST_LIST_ENDPOINT_TEMPLATE in .env - no code change needed.
 *
 * `listRef` is whatever comes after mdblist.com/lists/ in your list's URL,
 * e.g. "username/my-trending-movies".
 */
export async function fetchMdblistTmdbIds(listRef: string): Promise<string[]> {
  if (!listRef || !config.mdblistApiKey) return [];

  const url = config.mdblistListEndpointTemplate
    .replace('{list}', listRef)
    .replace('{apikey}', config.mdblistApiKey);

  try {
    const res = await fetchWithTimeout(url, config.requestTimeoutMs);
    if (!res.ok) {
      logger.warn('[mdblist] request failed - check MDBLIST_LIST_ENDPOINT_TEMPLATE against docs.mdblist.com', url, res.status);
      return [];
    }
    const data = (await res.json()) as any;
    const items: any[] = Array.isArray(data) ? data : data.items || data.movies || data.shows || [];
    return items
      .map((item) => item.tmdbid ?? item.tmdb_id ?? item.ids?.tmdb)
      .filter((id) => id !== undefined && id !== null)
      .map(String);
  } catch (err) {
    logger.warn('[mdblist] fetch failed', listRef, err);
    return [];
  }
}
