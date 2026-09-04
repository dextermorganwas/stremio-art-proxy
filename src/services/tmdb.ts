import { config } from '../config';
import { cacheGet, cacheSet } from './cache';
import { fetchWithTimeout } from './httpQueue';
import { dedupe } from './inflight';
import { logger } from '../logger';
import { TmdbImage, TmdbImagesPayload, TmdbMediaType } from '../types';

interface FindResult {
  tmdbId: string;
  mediaType: TmdbMediaType;
}

export async function findByExternalId(
  source: 'imdb_id' | 'tvdb_id',
  id: string
): Promise<FindResult | null> {
  const cacheKey = `tmdb-find:${source}:${id}`;
  const cached = cacheGet<FindResult | null>(cacheKey);
  if (cached !== undefined) return cached;

  return dedupe(cacheKey, async () => {
    const url = `${config.tmdbBaseUrl}/find/${id}?api_key=${config.tmdbApiKey}&external_source=${source}`;
    try {
      const res = await fetchWithTimeout(url, config.requestTimeoutMs);
      if (!res.ok) {
        cacheSet(cacheKey, null, 3600);
        return null;
      }
      const data = (await res.json()) as any;
      let result: FindResult | null = null;
      if (data.movie_results?.length) {
        result = { tmdbId: String(data.movie_results[0].id), mediaType: 'movie' };
      } else if (data.tv_results?.length) {
        result = { tmdbId: String(data.tv_results[0].id), mediaType: 'tv' };
      }
      cacheSet(cacheKey, result, result ? config.tmdbPayloadTtlSeconds : 3600);
      return result;
    } catch (err) {
      logger.warn('[tmdb] findByExternalId failed', source, id, err);
      return null;
    }
  });
}

function mapImage(img: any): TmdbImage {
  return {
    file_path: img.file_path,
    width: img.width,
    height: img.height,
    vote_average: img.vote_average ?? 0,
    vote_count: img.vote_count ?? 0,
    iso_639_1: img.iso_639_1 ?? null,
  };
}

/**
 * Fetches title details (for original_language) + images restricted to
 * english + original-language + textless(null) in a single logical unit.
 * Cached once per tmdb id and reused across poster/backdrop/logo requests
 * for the same title.
 */
export async function getImages(
  mediaType: TmdbMediaType,
  tmdbId: string
): Promise<TmdbImagesPayload | null> {
  const cacheKey = `tmdb-images:${mediaType}:${tmdbId}`;
  const cached = cacheGet<TmdbImagesPayload | null>(cacheKey);
  if (cached !== undefined) return cached;

  return dedupe(cacheKey, async () => {
    try {
      const detailsUrl = `${config.tmdbBaseUrl}/${mediaType}/${tmdbId}?api_key=${config.tmdbApiKey}`;
      const detailsRes = await fetchWithTimeout(detailsUrl, config.requestTimeoutMs);
      if (!detailsRes.ok) {
        cacheSet(cacheKey, null, 3600);
        return null;
      }
      const details = (await detailsRes.json()) as any;
      const originalLanguage: string = details.original_language || 'en';

      const langParam = Array.from(new Set(['en', originalLanguage])).join(',');
      const imagesUrl = `${config.tmdbBaseUrl}/${mediaType}/${tmdbId}/images?api_key=${config.tmdbApiKey}&include_image_language=${langParam},null`;
      const imagesRes = await fetchWithTimeout(imagesUrl, config.requestTimeoutMs);
      if (!imagesRes.ok) {
        cacheSet(cacheKey, null, 3600);
        return null;
      }
      const imagesData = (await imagesRes.json()) as any;

      const payload: TmdbImagesPayload = {
        originalLanguage,
        posters: (imagesData.posters || []).map(mapImage),
        backdrops: (imagesData.backdrops || []).map(mapImage),
        logos: (imagesData.logos || []).map(mapImage),
      };

      cacheSet(cacheKey, payload, config.tmdbPayloadTtlSeconds);
      return payload;
    } catch (err) {
      logger.warn('[tmdb] getImages failed', mediaType, tmdbId, err);
      return null;
    }
  });
}

/**
 * Broader fetch used ONLY for the rare "best art across all languages"
 * last-resort fallback, so the common-case call above stays cheap.
 */
export async function getAllLanguageImages(
  mediaType: TmdbMediaType,
  tmdbId: string
): Promise<Pick<TmdbImagesPayload, 'posters' | 'backdrops' | 'logos'> | null> {
  const cacheKey = `tmdb-images-all:${mediaType}:${tmdbId}`;
  const cached = cacheGet<Pick<TmdbImagesPayload, 'posters' | 'backdrops' | 'logos'> | null>(cacheKey);
  if (cached !== undefined) return cached;

  return dedupe(cacheKey, async () => {
    try {
      const langParam = config.tmdbAllLanguagesFallbackList;
      const imagesUrl = `${config.tmdbBaseUrl}/${mediaType}/${tmdbId}/images?api_key=${config.tmdbApiKey}&include_image_language=${langParam},null`;
      const res = await fetchWithTimeout(imagesUrl, config.requestTimeoutMs);
      if (!res.ok) {
        cacheSet(cacheKey, null, 3600);
        return null;
      }
      const data = (await res.json()) as any;
      const payload = {
        posters: (data.posters || []).map(mapImage),
        backdrops: (data.backdrops || []).map(mapImage),
        logos: (data.logos || []).map(mapImage),
      };
      cacheSet(cacheKey, payload, config.tmdbPayloadTtlSeconds);
      return payload;
    } catch (err) {
      logger.warn('[tmdb] getAllLanguageImages failed', mediaType, tmdbId, err);
      return null;
    }
  });
}

export function tmdbImageUrl(size: string, filePath: string): string {
  return `${config.tmdbImageBaseUrl}/${size}${filePath}`;
}
