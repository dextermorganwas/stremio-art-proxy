import { config } from '../config';
import { SashKey, TitleMeta } from '../types';

const SASH_LABELS: Record<SashKey, string> = {
  airing: 'Airing',
  returning: 'Returning',
  ended: 'Ended',
  canceled: 'Canceled',
  recentlyAdded: 'Recently Added',
};

function sashColor(key: SashKey): string {
  switch (key) {
    case 'airing':
      return config.sashColorAiring;
    case 'returning':
      return config.sashColorReturning;
    case 'ended':
      return config.sashColorEnded;
    case 'canceled':
      return config.sashColorCanceled;
    case 'recentlyAdded':
      return config.sashColorRecentlyAdded;
  }
}

function daysBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 86_400_000;
}

/**
 * Decides which status sash (if any) applies. Movies only ever get
 * "Recently Added" (based on release_date recency - TMDB has no concept of
 * "when you added this to your library", so release recency is the closest
 * proxy). TV shows get Airing/Returning/Ended/Canceled based on TMDB's
 * `status` field, with Airing vs Returning distinguished by how close the
 * nearest aired/airing episode is (`AIRING_WINDOW_DAYS`).
 */
export function determineSashKey(meta: TitleMeta, now: Date = new Date()): SashKey | null {
  if (meta.mediaType === 'movie') {
    if (!meta.releaseDate) return null;
    const days = daysBetween(new Date(meta.releaseDate), now);
    if (days >= 0 && days <= config.recentAddedWindowDays) return 'recentlyAdded';
    return null;
  }

  const status = (meta.status || '').toLowerCase();
  if (status === 'ended') return 'ended';
  if (status === 'canceled' || status === 'cancelled') return 'canceled';

  if (['returning series', 'in production', 'planned', 'pilot'].includes(status)) {
    if (meta.nextEpisodeAirDate) {
      const days = daysBetween(now, new Date(meta.nextEpisodeAirDate));
      if (days >= -config.airingWindowDays && days <= config.airingWindowDays) return 'airing';
    }
    if (meta.lastEpisodeAirDate) {
      const days = daysBetween(new Date(meta.lastEpisodeAirDate), now);
      if (days >= 0 && days <= config.airingWindowDays) return 'airing';
    }
    return 'returning';
  }

  return null;
}

export function buildSash(meta: TitleMeta): { key: SashKey; label: string; color: string } | null {
  if (!config.enableStatusSash) return null;
  const key = determineSashKey(meta);
  if (!key) return null;
  return { key, label: SASH_LABELS[key], color: sashColor(key) };
}
