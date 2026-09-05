import { config } from '../config';
import { getTmdbTrendingIds } from './tmdb';
import { fetchMdblistTmdbIds } from './mdblist';
import { TmdbMediaType } from '../types';
import { logger } from '../logger';

interface TrendingSets {
  movie: Set<string>;
  tv: Set<string>;
}

let cached: { sets: TrendingSets; expiresAt: number } | null = null;
let refreshing: Promise<TrendingSets> | null = null;

async function loadTrendingSets(): Promise<TrendingSets> {
  try {
    if (config.trendingSource === 'mdblist') {
      const [movies, tv] = await Promise.all([
        fetchMdblistTmdbIds(config.mdblistMovieList),
        fetchMdblistTmdbIds(config.mdblistTvList),
      ]);
      return { movie: new Set(movies), tv: new Set(tv) };
    }

    const [movies, tv] = await Promise.all([getTmdbTrendingIds('movie'), getTmdbTrendingIds('tv')]);
    return { movie: new Set(movies), tv: new Set(tv) };
  } catch (err) {
    logger.warn('[trending] failed to load trending set', err);
    return { movie: new Set(), tv: new Set() };
  }
}

async function getTrendingSets(): Promise<TrendingSets> {
  if (cached && cached.expiresAt > Date.now()) return cached.sets;
  if (!refreshing) {
    refreshing = loadTrendingSets().finally(() => {
      refreshing = null;
    });
  }
  const sets = await refreshing;
  cached = { sets, expiresAt: Date.now() + config.trendingRefreshIntervalSeconds * 1000 };
  return sets;
}

export async function isTrending(mediaType: TmdbMediaType, tmdbId: string): Promise<boolean> {
  if (!config.enableTrendingBadge) return false;
  const sets = await getTrendingSets();
  return (mediaType === 'movie' ? sets.movie : sets.tv).has(tmdbId);
}
