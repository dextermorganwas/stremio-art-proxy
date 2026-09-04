import { config } from '../config';
import { fetchWithTimeout } from './httpQueue';
import { cacheGet, cacheSet } from './cache';
import { logger } from '../logger';

export type MetahubKind = 'poster' | 'background' | 'logo';

export function metahubUrl(kind: MetahubKind, imdbId: string): string {
  const size =
    kind === 'poster' ? config.metahubPosterSize : kind === 'background' ? config.metahubBackgroundSize : 'medium';
  return `${config.metahubBaseUrl}/${kind}/${size}/${imdbId}/img`;
}

/**
 * The "a bit extra" check for poster/backdrop metahub fallback: a HEAD
 * request that also enforces a minimum content-length, so we don't redirect
 * clients to a tiny broken/placeholder image when metahub has nothing real.
 */
export async function verifyMetahubImage(url: string, strict: boolean): Promise<boolean> {
  const cacheKey = `metahub-verify:${url}:${strict ? 'strict' : 'basic'}`;
  const cached = cacheGet<boolean>(cacheKey);
  if (cached !== undefined) return cached;

  try {
    const res = await fetchWithTimeout(url, config.requestTimeoutMs, { method: 'HEAD' });
    if (!res.ok) {
      cacheSet(cacheKey, false, 3600);
      return false;
    }
    if (strict) {
      const len = Number(res.headers.get('content-length') || '0');
      const ok = len >= config.metahubMinContentLengthBytes;
      cacheSet(cacheKey, ok, config.tmdbPayloadTtlSeconds);
      return ok;
    }
    cacheSet(cacheKey, true, config.tmdbPayloadTtlSeconds);
    return true;
  } catch (err) {
    logger.debug('[metahub] verify failed', url, err);
    return false;
  }
}
