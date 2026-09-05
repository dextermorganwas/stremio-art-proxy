export type ArtType = 'poster' | 'backdrop' | 'logo';
export type TmdbMediaType = 'movie' | 'tv';

export interface ParsedIds {
  tmdbId?: string;
  tmdbType?: TmdbMediaType;
  imdbId?: string;
  tvdbId?: string;
}

export interface TmdbImage {
  file_path: string;
  width: number;
  height: number;
  vote_average: number;
  vote_count: number;
  iso_639_1: string | null;
}

export interface TitleMeta {
  mediaType: TmdbMediaType;
  releaseDate: string | null; // movies
  status: string | null; // tv: 'Returning Series' | 'Ended' | 'Canceled' | 'In Production' | 'Planned' | 'Pilot'
  nextEpisodeAirDate: string | null; // tv
  lastEpisodeAirDate: string | null; // tv
}

export interface TmdbImagesPayload {
  originalLanguage: string;
  posters: TmdbImage[];
  backdrops: TmdbImage[];
  logos: TmdbImage[];
  meta: TitleMeta;
}

export type SashKey = 'airing' | 'returning' | 'ended' | 'canceled' | 'recentlyAdded';

export interface BadgeInfo {
  trending: boolean;
  sash: { key: SashKey; label: string; color: string } | null;
}
