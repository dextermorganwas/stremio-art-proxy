import { Router, Request, Response } from 'express';
import { parseIdString, cacheKeyFor } from '../utils/idParser';
import { resolveArt } from '../logic/selectArt';
import { cacheGet, cacheSet } from '../services/cache';
import { dedupe } from '../services/inflight';
import { config } from '../config';
import { logger } from '../logger';
import { ArtType } from '../types';

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

  const key = `resolved:${artType}:${cacheKeyFor(ids)}`;

  try {
    const cached = cacheGet<string>(key);
    if (cached) {
      return res.redirect(302, cached);
    }

    // Concurrent requests for the same item+art-type share one resolution.
    const result = await dedupe(key, async () => {
      const resolved = await resolveArt(artType, ids);
      if (resolved) {
        cacheSet(key, resolved.url, config.cacheTtlSeconds);
      }
      return resolved;
    });

    if (!result) {
      return res.status(404).send('No art found.');
    }

    logger.debug('[art]', artType, cacheKeyFor(ids), '->', result.source, result.url);
    return res.redirect(302, result.url);
  } catch (err) {
    logger.error('[art] request failed', artType, req.params.idString, err);
    return res.status(502).send('Upstream error.');
  }
});
