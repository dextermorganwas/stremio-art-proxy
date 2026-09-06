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

  // --- Trending "TOP" badge ---
  enableTrendingBadge: bool('ENABLE_TRENDING_BADGE', false),
  trendingSource: str('TRENDING_SOURCE', 'tmdb'), // tmdb | mdblist
  trendingTmdbWindow: str('TRENDING_TMDB_WINDOW', 'day'), // day | week
  trendingRefreshIntervalSeconds: num('TRENDING_REFRESH_INTERVAL_SECONDS', 3600),
  trendingBadgeColor: str('TRENDING_BADGE_COLOR', '#FF8A3D'),

  // MDBList - separate lists for movies/tv. `MDBLIST_*_LIST` accepts either
  // a full URL (https://mdblist.com/lists/username/slug) or just
  // "username/slug" - either works. Public lists need no API key at all
  // (uses MDBList's public JSON endpoint); MDBLIST_API_KEY is only kept
  // around in case you point the template at an authenticated endpoint.
  mdblistApiKey: str('MDBLIST_API_KEY', ''),
  mdblistMovieList: str('MDBLIST_MOVIE_LIST', ''),
  mdblistTvList: str('MDBLIST_TV_LIST', ''),
  mdblistListEndpointTemplate: str('MDBLIST_LIST_ENDPOINT_TEMPLATE', 'https://mdblist.com/lists/{list}/json'),

  // --- Bottom status sash ---
  enableStatusSash: bool('ENABLE_STATUS_SASH', false),
  // Shape: a thin full-width baseline plus a taller, centered, top-rounded
  // "tag" holding the label - not a plain full-height bar.
  sashBaselineHeightPercent: num('SASH_BASELINE_HEIGHT_PERCENT', 2.5),
  sashHeightPercent: num('SASH_HEIGHT_PERCENT', 9), // the raised "bump" section
  sashBumpWidthPercent: num('SASH_BUMP_WIDTH_PERCENT', 56),

  // 'auto' (default): color is extracted from the poster's own dominant/
  // vibrant color, per-poster - not a fixed color per status. 'status': use
  // the fixed SASH_COLOR_* below instead, same status = same color always.
  sashColorMode: str('SASH_COLOR_MODE', 'auto'),
  // In 'auto' mode, a candidate color's score must clear this (roughly
  // saturation x how mid-toned x how populated, each 0-1) to be used at all;
  // below it, the poster is judged too dark/desaturated for any accent color
  // to look good, and SASH_COLOR_DARK_FALLBACK is used instead.
  sashMinSaturationScore: num('SASH_MIN_SATURATION_SCORE', 0.15),
  sashColorDarkFallback: str('SASH_COLOR_DARK_FALLBACK', '#232326'),

  // Only used when SASH_COLOR_MODE=status.
  recentAddedWindowDays: num('RECENT_ADDED_WINDOW_DAYS', 30), // movies
  airingWindowDays: num('AIRING_WINDOW_DAYS', 14), // tv: "airing" vs "returning"
  sashColorAiring: str('SASH_COLOR_AIRING', '#2563EB'),
  sashColorReturning: str('SASH_COLOR_RETURNING', '#16A34A'),
  sashColorEnded: str('SASH_COLOR_ENDED', '#6B5B95'),
  sashColorCanceled: str('SASH_COLOR_CANCELED', '#DC2626'),
  sashColorRecentlyAdded: str('SASH_COLOR_RECENTLY_ADDED', '#DC2626'),

  // Badged (composited) posters are cached separately from plain resolved
  // URLs, and for less time, since trending/status data changes over time.
  badgeImageCacheTtlSeconds: num('BADGE_IMAGE_CACHE_TTL_SECONDS', 21600), // 6h
};

if (!config.tmdbApiKey) {
  // eslint-disable-next-line no-console
  console.warn('[config] WARNING: TMDB_API_KEY is not set - TMDB lookups will fail and only Metahub fallback will work.');
}
