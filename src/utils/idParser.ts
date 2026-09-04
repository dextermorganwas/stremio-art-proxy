import { ParsedIds, TmdbMediaType } from '../types';

const EXT_RE = /\.(jpg|jpeg|png|webp)$/i;

/**
 * Parses segments like:
 *   tmdb:movie:123&imdb:tt1234567
 *   tmdb:series:123&imdb:            (imdb blanked because AIOMetadata's "?" had no value)
 *   imdb:tt1234567
 *   tvdb:12345&tmdb:series:123
 * Order and presence of each id are not assumed - every "prefix:value(:value)" chunk
 * separated by "&" is parsed independently.
 */
export function parseIdString(raw: string): ParsedIds {
  const stripped = decodeURIComponent(raw).replace(EXT_RE, '');
  const segments = stripped.split('&').map((s) => s.trim()).filter(Boolean);

  const result: ParsedIds = {};

  for (const segment of segments) {
    const parts = segment.split(':');
    const prefix = (parts[0] || '').toLowerCase();

    if (prefix === 'tmdb') {
      // tmdb:{type}:{id}
      const type = (parts[1] || '').toLowerCase();
      const id = parts[2];
      if (type === 'movie' || type === 'series' || type === 'tv') {
        result.tmdbType = (type === 'series' ? 'tv' : type) as TmdbMediaType;
      }
      if (id) result.tmdbId = id;
    } else if (prefix === 'imdb') {
      const id = parts[1];
      if (id) result.imdbId = id;
    } else if (prefix === 'tvdb') {
      const id = parts[1];
      if (id) result.tvdbId = id;
    }
  }

  return result;
}

/** Stable cache key regardless of which ids were supplied. */
export function cacheKeyFor(ids: ParsedIds): string {
  return (
    [
      ids.tmdbId ? `tmdb:${ids.tmdbType || ''}:${ids.tmdbId}` : '',
      ids.imdbId ? `imdb:${ids.imdbId}` : '',
      ids.tvdbId ? `tvdb:${ids.tvdbId}` : '',
    ]
      .filter(Boolean)
      .join('|') || 'unknown'
  );
}
