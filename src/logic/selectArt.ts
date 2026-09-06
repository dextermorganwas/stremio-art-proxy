import { config } from '../config';
import { ArtType, ParsedIds, TmdbImage, TmdbImagesPayload, TmdbMediaType } from '../types';
import { findByExternalId, getImages, tmdbImageUrl } from '../services/tmdb';
import { metahubUrl, MetahubKind, verifyMetahubImage } from '../services/metahub';
import { isBetterCandidate, selectBestImage } from './scoring';
import { logger } from '../logger';

export interface ResolvedArt {
  url: string;
  source: string; // handy for debug logging - which path found it
}

interface Identity {
  tmdbId: string;
  mediaType: TmdbMediaType;
}

export async function resolveTmdbIdentity(ids: ParsedIds): Promise<Identity | null> {
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

async function tryMetahub(artType: ArtType, imdbId: string | undefined, verify: boolean): Promise<ResolvedArt | null> {
  if (!imdbId) return null;
  const kind: MetahubKind = artType === 'poster' ? 'poster' : artType === 'backdrop' ? 'background' : 'logo';
  const url = metahubUrl(kind, imdbId);

  if (verify) {
    const ok = await verifyMetahubImage(url, true);
    if (!ok) return null;
  }
  return { url, source: 'metahub' };
}

export async function resolveArt(artType: ArtType, ids: ParsedIds): Promise<ResolvedArt | null> {
  const identity = await resolveTmdbIdentity(ids);
  const payload = identity ? await getImages(identity.mediaType, identity.tmdbId) : null;

  if (artType === 'poster') return resolvePoster(payload, ids);
  if (artType === 'backdrop') return resolveBackdrop(payload, ids);
  return resolveLogo(payload, ids);
}

// ---------------------------------------------------------------------------
// Posters: fallback to Metahub only when TMDB's combined English + original-
// language coverage is thin or empty (not a separate "every language TMDB
// has" call - that requires enumerating a huge language list, which TMDB
// doesn't reliably support and previously corrupted results). Textless
// (iso_639_1 === null) images are NEVER eligible as a poster - that tag
// means "no text/logo", which TMDB also uses for deliberately clean/skin-
// ready art; a textless image showing up as a poster is always wrong.
// ---------------------------------------------------------------------------
async function resolvePoster(payload: TmdbImagesPayload | null, ids: ParsedIds): Promise<ResolvedArt | null> {
  const minWidth = config.minPosterWidth;
  const tmdbSize = config.tmdbPosterSize;

  const nonTextless = (payload?.posters ?? []).filter((i) => i.iso_639_1 !== null);
  const overallEligible = nonTextless.filter((i) => i.width >= minWidth);
  const overallTooThin = overallEligible.length < config.minBracketSize;

  if (overallTooThin) {
    const metahub = await tryMetahub('poster', ids.imdbId, config.metahubVerifyExtraCheck);
    if (metahub) return metahub;
    // Metahub had nothing either - fall through and use TMDB's thin
    // selection rather than returning nothing.
  }

  const brackets: { name: string; images: TmdbImage[] }[] = [];
  if (payload) {
    brackets.push({ name: 'english', images: nonTextless.filter((i) => i.iso_639_1 === 'en') });
    if (payload.originalLanguage !== 'en') {
      brackets.push({ name: 'original', images: nonTextless.filter((i) => i.iso_639_1 === payload.originalLanguage) });
    }
  }

  let bestFallback: { image: TmdbImage; bracketName: string } | null = null;

  for (const bracket of brackets) {
    const selection = selectBestImage(bracket.images, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
    if (!selection.image) continue;

    if (!overallTooThin) {
      return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: `tmdb:${bracket.name}` };
    }

    if (!bestFallback || isBetterCandidate(selection.image, bestFallback.image)) {
      bestFallback = { image: selection.image, bracketName: bracket.name };
    }
  }

  if (bestFallback) {
    return { url: tmdbImageUrl(tmdbSize, bestFallback.image.file_path), source: `tmdb:${bestFallback.bracketName}:thin-fallback` };
  }

  // Absolute last resort: best NON-TEXTLESS poster TMDB has for this title.
  if (nonTextless.length > 0) {
    const selection = selectBestImage(nonTextless, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
    if (selection.image) {
      return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: 'tmdb:any-language' };
    }
  }

  if (config.fallbackImageUrl) return { url: config.fallbackImageUrl, source: 'placeholder' };
  logger.debug('[selectArt] no poster found for', ids);
  return null;
}

// ---------------------------------------------------------------------------
// Backdrops: MUST stay textless (iso_639_1 === null) at every stage, since
// `payload` already contains every language in one fetch.
// ---------------------------------------------------------------------------
async function resolveBackdrop(payload: TmdbImagesPayload | null, ids: ParsedIds): Promise<ResolvedArt | null> {
  const minWidth = config.minBackdropWidth;
  const tmdbSize = config.tmdbBackdropSize;

  const textless = (payload?.backdrops ?? []).filter((i) => i.iso_639_1 === null);
  const selection = selectBestImage(textless, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
  const eligibleCount = textless.filter((i) => i.width >= minWidth).length;
  const preferMetahub = eligibleCount < config.minBracketSize || selection.confidence !== 'good';

  if (selection.image && !preferMetahub) {
    return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: 'tmdb:textless' };
  }

  if (preferMetahub) {
    const metahub = await tryMetahub('backdrop', ids.imdbId, config.metahubVerifyExtraCheck);
    if (metahub) return metahub;
  }

  if (selection.image) {
    return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: 'tmdb:textless:low-confidence' };
  }

  if (config.fallbackImageUrl) return { url: config.fallbackImageUrl, source: 'placeholder' };
  logger.debug('[selectArt] no textless backdrop found for', ids);
  return null;
}

// ---------------------------------------------------------------------------
// Logos: Metahub is used ONLY when TMDB has literally no logo in either the
// english or original-language bracket - no vote-quality gate at all.
// ---------------------------------------------------------------------------
async function resolveLogo(payload: TmdbImagesPayload | null, ids: ParsedIds): Promise<ResolvedArt | null> {
  const minWidth = config.minLogoWidth;
  const tmdbSize = config.tmdbLogoSize;

  const brackets: { name: string; images: TmdbImage[] }[] = [];
  if (payload) {
    brackets.push({ name: 'english', images: payload.logos.filter((i) => i.iso_639_1 === 'en') });
    if (payload.originalLanguage !== 'en') {
      brackets.push({ name: 'original', images: payload.logos.filter((i) => i.iso_639_1 === payload.originalLanguage) });
    }
  }

  for (const bracket of brackets) {
    const selection = selectBestImage(bracket.images, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
    if (selection.image) {
      return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: `tmdb:${bracket.name}` };
    }
  }

  const metahub = await tryMetahub('logo', ids.imdbId, false);
  if (metahub) return metahub;

  if (payload) {
    const selection = selectBestImage(payload.logos, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
    if (selection.image) {
      return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: 'tmdb:all-languages' };
    }
  }

  if (config.fallbackImageUrl) return { url: config.fallbackImageUrl, source: 'placeholder' };
  logger.debug('[selectArt] no logo found for', ids);
  return null;
}
