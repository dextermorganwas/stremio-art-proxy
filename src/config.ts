import 'dotenv/config';

function num(name: string, def: number): number {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function str(name: string, def: string): string {
  const v = process.env[name];
  return v === undefined || v === '' ? def : v;
}

function bool(name: string, def: boolean): boolean {
  const v = process.env[name];
  if (v === undefined || v === '') return def;
  return v.toLowerCase() === 'true' || v === '1';
}

export const config = {
  port: num('PORT', 3000),
  logLevel: str('LOG_LEVEL', 'info'), // error | warn | info | debug

  // --- TMDB ---
  tmdbApiKey: str('TMDB_API_KEY', ''),
  tmdbBaseUrl: str('TMDB_BASE_URL', 'https://api.themoviedb.org/3'),
  tmdbImageBaseUrl: str('TMDB_IMAGE_BASE_URL', 'https://image.tmdb.org/t/p'),
  tmdbPosterSize: str('TMDB_POSTER_SIZE', 'w780'),
  tmdbBackdropSize: str('TMDB_BACKDROP_SIZE', 'w1280'),
  tmdbLogoSize: str('TMDB_LOGO_SIZE', 'w500'),
  // Used ONLY for the rare "best art out of all languages" last-resort fallback.
  tmdbAllLanguagesFallbackList: str(
    'TMDB_ALL_LANGUAGES_FALLBACK_LIST',
    'en,fr,es,de,it,pt,ru,ja,ko,zh,nl,sv,no,da,fi,pl,tr,ar,hi,th,cs,el,he,hu,id,vi,uk,ro,sk,bg'
  ),

  // --- Metahub / Cinemeta fallback ---
  metahubBaseUrl: str('METAHUB_BASE_URL', 'https://images.metahub.space'),
  metahubPosterSize: str('METAHUB_POSTER_SIZE', 'medium'), // small | medium | large
  metahubBackgroundSize: str('METAHUB_BACKGROUND_SIZE', 'medium'),
  // "a bit extra" verification for poster/backdrop metahub fallback: HEAD request
  // + minimum content-length, so we don't redirect to a broken/placeholder image.
  metahubVerifyExtraCheck: bool('METAHUB_VERIFY_EXTRA_CHECK', true),
  metahubMinContentLengthBytes: num('METAHUB_MIN_CONTENT_LENGTH_BYTES', 5000),

  // --- Caching ---
  cacheTtlSeconds: num('CACHE_TTL_SECONDS', 604800), // 7 days - final resolved art URL
  tmdbPayloadTtlSeconds: num('TMDB_PAYLOAD_TTL_SECONDS', 604800), // raw TMDB responses
  cacheBackend: str('CACHE_BACKEND', 'memory'), // memory | disk
  cacheDir: str('CACHE_DIR', '/data/cache'),

  // --- Quality thresholds ---
  minPosterWidth: num('MIN_POSTER_WIDTH', 750),
  minBackdropWidth: num('MIN_BACKDROP_WIDTH', 1280), // ~720p landscape width
  minLogoWidth: num('MIN_LOGO_WIDTH', 0),

  // --- Scoring (vote count floor that steps down until it finds candidates) ---
  voteFloorStart: num('VOTE_FLOOR_START', 10),
  voteFloorMin: num('VOTE_FLOOR_MIN', 4),
  voteFloorStep: num('VOTE_FLOOR_STEP', 2),
  // If a TMDB language bracket has fewer than this many eligible images,
  // or its best pick never met even the minimum vote floor, we bring
  // Metahub into consideration instead of treating it as pure last resort.
  minBracketSize: num('MIN_BRACKET_SIZE', 5),

  // --- Networking / resource usage ---
  requestTimeoutMs: num('REQUEST_TIMEOUT_MS', 8000),
  maxConcurrentUpstream: num('MAX_CONCURRENT_UPSTREAM', 10),

  // Optional: redirect here if literally nothing could be found anywhere.
  fallbackImageUrl: str('FALLBACK_IMAGE_URL', ''),
};

if (!config.tmdbApiKey) {
  // eslint-disable-next-line no-console
  console.warn('[config] WARNING: TMDB_API_KEY is not set - TMDB lookups will fail and only Metahub fallback will work.');
}
