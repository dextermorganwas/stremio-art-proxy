import { Router, Request, Response } from 'express';
import { parseIdString, cacheKeyFor } from '../utils/idParser';
import { resolveArt, resolveTmdbIdentity } from '../logic/selectArt';
import { getImages } from '../services/tmdb';
import { isTrending } from '../services/trending';
import { buildSash } from '../logic/badges';
import { renderBadgedPoster } from '../services/imageCompose';
import { cacheGet, cacheSet } from '../services/cache';
import { dedupe } from '../services/inflight';
import { config } from '../config';
import { logger } from '../logger';
import { ArtType, BadgeInfo, ParsedIds } from '../types';

export const artRouter = Router();

const VALID_TYPES: ArtType[] = ['poster', 'backdrop', 'logo'];

artRouter.get('/:artType/:idString', async (req: Request, res: Response) => {
  const artType = req.params.artType as ArtType;
  if (!VALID_TYPES.includes(artType)) {
    return res.status(404).send('Unknown art type. Use /poster, /backdrop, or /logo.');
  }

  const ids = parseIdString(req.params.idString);
  if (!ids.tmdbId && !ids.imdbId && !ids.tvdbId) {
    return res.status(400).send('No usable id found in request.');
  }

  const badgesPossible = artType === 'poster' && (config.enableTrendingBadge || config.enableStatusSash);

  try {
    if (badgesPossible) {
      return await handleBadgedPoster(req, res, ids);
    }
    return await handlePlainRedirect(req, res, artType, ids);
  } catch (err) {
    logger.error('[art] request failed', artType, req.params.idString, err);
    return res.status(502).send('Upstream error.');
  }
});

async function handlePlainRedirect(_req: Request, res: Response, artType: ArtType, ids: ParsedIds) {
  const key = `resolved:${artType}:${cacheKeyFor(ids)}`;

  const cached = cacheGet<string>(key);
  if (cached) return res.redirect(302, cached);

  // Concurrent requests for the same item+art-type share one resolution.
  const result = await dedupe(key, async () => {
    const resolved = await resolveArt(artType, ids);
    if (resolved) cacheSet(key, resolved.url, config.cacheTtlSeconds);
    return resolved;
  });

  if (!result) return res.status(404).send('No art found.');

  logger.debug('[art]', artType, cacheKeyFor(ids), '->', result.source, result.url);
  return res.redirect(302, result.url);
}

async function getBadgeInfo(ids: ParsedIds): Promise<BadgeInfo> {
  const identity = await resolveTmdbIdentity(ids);
  if (!identity) return { trending: false, sash: null };

  const [trending, payload] = await Promise.all([
    config.enableTrendingBadge ? isTrending(identity.mediaType, identity.tmdbId) : Promise.resolve(false),
    config.enableStatusSash ? getImages(identity.mediaType, identity.tmdbId) : Promise.resolve(null),
  ]);

  return { trending, sash: payload ? buildSash(payload.meta) : null };
}

async function handleBadgedPoster(_req: Request, res: Response, ids: ParsedIds) {
  const baseKey = `resolved:poster:${cacheKeyFor(ids)}`;
  const badgedKey = `${baseKey}:badged`;

  const cachedBadged = cacheGet<{ base64: string; contentType: string }>(badgedKey);
  if (cachedBadged) {
    res.set('Content-Type', cachedBadged.contentType);
    res.set('Cache-Control', `public, max-age=${config.badgeImageCacheTtlSeconds}`);
    return res.send(Buffer.from(cachedBadged.base64, 'base64'));
  }

  const cachedPlainUrl = cacheGet<string>(baseKey);

  const result = await dedupe(badgedKey, async () => {
    const resolved = cachedPlainUrl ? { url: cachedPlainUrl, source: 'cache' } : await resolveArt('poster', ids);
    if (!resolved) return null;
    if (!cachedPlainUrl) cacheSet(baseKey, resolved.url, config.cacheTtlSeconds);

    const badges = await getBadgeInfo(ids);
    if (!badges.trending && !badges.sash) {
      return { kind: 'redirect' as const, url: resolved.url };
    }

    const composited = await renderBadgedPoster(resolved.url, badges);
    if (!composited) return { kind: 'redirect' as const, url: resolved.url }; // fail-safe

    return { kind: 'image' as const, ...composited };
  });

  if (!result) return res.status(404).send('No art found.');

  if (result.kind === 'redirect') {
    return res.redirect(302, result.url);
  }

  cacheSet(badgedKey, { base64: result.buffer.toString('base64'), contentType: result.contentType }, config.badgeImageCacheTtlSeconds);
  res.set('Content-Type', result.contentType);
  res.set('Cache-Control', `public, max-age=${config.badgeImageCacheTtlSeconds}`);
  return res.send(result.buffer);
}
