import { config } from '../config';
import { ArtType, ParsedIds, TmdbImage, TmdbMediaType } from '../types';
import { findByExternalId, getAllLanguageImages, getImages, tmdbImageUrl } from '../services/tmdb';
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

  if (artType === 'poster') return resolvePoster(identity, ids);
  if (artType === 'backdrop') return resolveBackdrop(identity, ids);
  return resolveLogo(identity, ids);
}

// ---------------------------------------------------------------------------
// Posters: fallback to Metahub only when TMDB's *overall* coverage (across
// every language, not just the english/original bracket) is thin or empty.
// Once TMDB coverage is judged sufficient, English-first cascade applies with
// no additional vote-quality gate - we just take the best of whichever
// bracket has candidates.
// ---------------------------------------------------------------------------
async function resolvePoster(identity: Identity | null, ids: ParsedIds): Promise<ResolvedArt | null> {
  const minWidth = config.minPosterWidth;
  const tmdbSize = config.tmdbPosterSize;

  const payload = identity ? await getImages(identity.mediaType, identity.tmdbId) : null;
  // Fetched eagerly (not lazily) because "too few art" is now judged across
  // ALL languages, not just the english/original bracket already in `payload`.
  const allPayload = identity ? await getAllLanguageImages(identity.mediaType, identity.tmdbId) : null;

  const overallEligible = (allPayload?.posters ?? []).filter((i) => i.width >= minWidth);
  const overallTooThin = overallEligible.length < config.minBracketSize;

  if (overallTooThin) {
    const metahub = await tryMetahub('poster', ids.imdbId, config.metahubVerifyExtraCheck);
    if (metahub) return metahub;
    // Metahub had nothing either - fall through and use TMDB's thin
    // selection rather than returning nothing.
  }

  const brackets: { name: string; images: TmdbImage[] }[] = [];
  if (payload) {
    brackets.push({ name: 'english', images: payload.posters.filter((i) => i.iso_639_1 === 'en') });
    if (payload.originalLanguage !== 'en') {
      brackets.push({ name: 'original', images: payload.posters.filter((i) => i.iso_639_1 === payload.originalLanguage) });
    }
  }

  let bestFallback: { image: TmdbImage; bracketName: string } | null = null;

  for (const bracket of brackets) {
    const selection = selectBestImage(bracket.images, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
    if (!selection.image) continue;

    if (!overallTooThin) {
      // TMDB's overall coverage is healthy - trust the english-first
      // cascade and return immediately, no vote-quality gate.
      return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: `tmdb:${bracket.name}` };
    }

    // Overall coverage was thin and Metahub didn't pan out - rank every
    // bracket's best candidate against each other rather than keeping
    // whichever bracket happened to be checked first.
    if (!bestFallback || isBetterCandidate(selection.image, bestFallback.image)) {
      bestFallback = { image: selection.image, bracketName: bracket.name };
    }
  }

  if (bestFallback) {
    return { url: tmdbImageUrl(tmdbSize, bestFallback.image.file_path), source: `tmdb:${bestFallback.bracketName}:thin-fallback` };
  }

  // Absolute last resort: best poster across all languages (already fetched above).
  if (allPayload) {
    const selection = selectBestImage(allPayload.posters, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
    if (selection.image) {
      return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: 'tmdb:all-languages' };
    }
  }

  if (config.fallbackImageUrl) return { url: config.fallbackImageUrl, source: 'placeholder' };
  logger.debug('[selectArt] no poster found for', ids);
  return null;
}

// ---------------------------------------------------------------------------
// Backdrops: MUST stay textless (iso_639_1 === null) at every single stage,
// including the absolute-last-resort "all languages" step. Never silently
// hand back a backdrop with burned-in text just because nothing textless
// was found - better to fall through to Metahub or return nothing.
// ---------------------------------------------------------------------------
async function resolveBackdrop(identity: Identity | null, ids: ParsedIds): Promise<ResolvedArt | null> {
  const minWidth = config.minBackdropWidth;
  const tmdbSize = config.tmdbBackdropSize;

  const payload = identity ? await getImages(identity.mediaType, identity.tmdbId) : null;
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

  // Absolute last resort: still textless-only, just widened to every
  // language's textless backdrops rather than en/original/null combo.
  if (identity) {
    const all = await getAllLanguageImages(identity.mediaType, identity.tmdbId);
    const allTextless = (all?.backdrops ?? []).filter((i) => i.iso_639_1 === null);
    const wideSelection = selectBestImage(allTextless, minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
    if (wideSelection.image) {
      return { url: tmdbImageUrl(tmdbSize, wideSelection.image.file_path), source: 'tmdb:all-languages-textless' };
    }
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
// english or original-language bracket - no vote-quality gate at all. If a
// bracket has any eligible logo, it wins immediately, regardless of votes.
// ---------------------------------------------------------------------------
async function resolveLogo(identity: Identity | null, ids: ParsedIds): Promise<ResolvedArt | null> {
  const minWidth = config.minLogoWidth;
  const tmdbSize = config.tmdbLogoSize;

  const payload = identity ? await getImages(identity.mediaType, identity.tmdbId) : null;

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

  // Both brackets came up completely empty - now, and only now, try Metahub.
  const metahub = await tryMetahub('logo', ids.imdbId, false);
  if (metahub) return metahub;

  // Absolute last resort: best logo across all languages.
  if (identity) {
    const all = await getAllLanguageImages(identity.mediaType, identity.tmdbId);
    const selection = selectBestImage(all?.logos ?? [], minWidth, config.voteFloorStart, config.voteFloorMin, config.voteFloorStep);
    if (selection.image) {
      return { url: tmdbImageUrl(tmdbSize, selection.image.file_path), source: 'tmdb:all-languages' };
    }
  }

  if (config.fallbackImageUrl) return { url: config.fallbackImageUrl, source: 'placeholder' };
  logger.debug('[selectArt] no logo found for', ids);
  return null;
}
