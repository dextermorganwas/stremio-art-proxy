import { config } from '../config';
import { ArtType, ParsedIds, TmdbImage, TmdbMediaType } from '../types';
import { findByExternalId, getAllLanguageImages, getImages, tmdbImageUrl } from '../services/tmdb';
import { metahubUrl, MetahubKind, verifyMetahubImage } from '../services/metahub';
import { selectBestImage } from './scoring';
import { logger } from '../logger';

export interface ResolvedArt {
  url: string;
  source: string; // handy for debug logging - which path found it
}

interface Identity {
  tmdbId: string;
  mediaType: TmdbMediaType;
}

async function resolveTmdbIdentity(ids: ParsedIds): Promise<Identity | null> {
  if (ids.tmdbId && ids.tmdbType) {
    return { tmdbId: ids.tmdbId, mediaType: ids.tmdbType };
  }
  if (ids.imdbId) {
    const found = await findByExternalId('imdb_id', ids.imdbId);
    if (found) return found;
  }
  if (ids.tvdbId) {
    const found = await findByExternalId('tvdb_id', ids.tvdbId);
    if (found) return found;
  }
  return null;
}

interface Bracket {
  name: string;
  images: TmdbImage[];
}

export async function resolveArt(artType: ArtType, ids: ParsedIds): Promise<ResolvedArt | null> {
  const identity = await resolveTmdbIdentity(ids);

  const minWidth =
    artType === 'poster' ? config.minPosterWidth : artType === 'backdrop' ? config.minBackdropWidth : config.minLogoWidth;

  const tmdbSize =
    artType === 'poster' ? config.tmdbPosterSize : artType === 'backdrop' ? config.tmdbBackdropSize : config.tmdbLogoSize;

  const payload = identity ? await getImages(identity.mediaType, identity.tmdbId) : null;

  const brackets: Bracket[] = [];
  if (payload) {
    const pool = artType === 'poster' ? payload.posters : artType === 'backdrop' ? payload.backdrops : payload.logos;

    if (artType === 'backdrop') {
      // TMDB has no explicit "textless" flag; by convention, backdrops with
      // no burned-in text carry no language tag (iso_639_1 === null).
      brackets.push({ name: 'textless', images: pool.filter((i) => i.iso_639_1 === null) });
    } else {
      brackets.push({ name: 'english', images: pool.filter((i) => i.iso_639_1 === 'en') });
      if (payload.originalLanguage !== 'en') {
        brackets.push({ name: 'original', images: pool.filter((i) => i.iso_639_1 === payload.originalLanguage) });
      }
    }
  }

  // Keep the best "good enough" candidate seen so far in case every bracket
  // and metahub come up empty and we have to settle for something.
  let bestFallback: { image: TmdbImage; bracketName: string } | null = null;

  for (const bracket of brackets) {
    const selection = selectBestImage(bracket.images, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);

    const eligibleCount = bracket.images.filter((i) => i.width >= minWidth).length;
    const needsHelp = eligibleCount < config.minBracketSize || selection.confidence !== 'good';

    if (selection.image && !needsHelp) {
      return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: `tmdb:${bracket.name}` };
    }

    if (selection.image && !bestFallback) {
      bestFallback = { image: selection.image, bracketName: bracket.name };
    }

    // Bracket was too thin or too low-confidence: give metahub a real shot,
    // not just as an absolute last resort. (Not applicable to logos here -
    // logo metahub fallback happens once, after both brackets are tried.)
    if (needsHelp && artType !== 'logo') {
      const metahub = await tryMetahub(artType, ids.imdbId);
      if (metahub) return metahub;
    }
  }

  if (artType === 'logo') {
    const metahub = await tryMetahub('logo', ids.imdbId);
    if (metahub) return metahub;
  }

  // Absolute last resort: best art across all languages on TMDB.
  if (identity) {
    const all = await getAllLanguageImages(identity.mediaType, identity.tmdbId);
    if (all) {
      const pool = artType === 'poster' ? all.posters : artType === 'backdrop' ? all.backdrops : all.logos;
      const selection = selectBestImage(pool, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
      if (selection.image) {
        return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: 'tmdb:all-languages' };
      }
    }
  }

  if (bestFallback) {
    return {
      url: tmdbImageUrl(tmdbSize, bestFallback.image.file_path),
      source: `tmdb:${bestFallback.bracketName}:low-confidence`,
    };
  }

  if (config.fallbackImageUrl) {
    return { url: config.fallbackImageUrl, source: 'placeholder' };
  }

  logger.debug('[selectArt] no art found for', artType, ids);
  return null;
}

async function tryMetahub(artType: ArtType, imdbId?: string): Promise<ResolvedArt | null> {
  if (!imdbId) return null;
  const kind: MetahubKind = artType === 'poster' ? 'poster' : artType === 'backdrop' ? 'background' : 'logo';
  const url = metahubUrl(kind, imdbId);

  if (artType === 'logo') {
    // Simple last-resort swap-in for logos, no extra verification.
    return { url, source: 'metahub' };
  }

  if (config.metahubVerifyExtraCheck) {
    const ok = await verifyMetahubImage(url, true);
    if (!ok) return null;
  }
  return { url, source: 'metahub' };
}
