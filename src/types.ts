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

export interface TmdbImagesPayload {
  originalLanguage: string;
  posters: TmdbImage[];
  backdrops: TmdbImage[];
  logos: TmdbImage[];
}
