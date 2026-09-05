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
  // TMDB's /images endpoint has no wildcard for include_image_language (confirmed
  // via their own dev forum - a "give me every language" option was requested
  // and never added), so getting broad coverage means enumerating codes. This
  // default is the full ISO 639-1 set, i.e. as close to "actually all languages"
  // as the API allows. If TMDB ever rejects a list this long, trim it here.
  tmdbAllLanguagesFallbackList: str(
    'TMDB_ALL_LANGUAGES_FALLBACK_LIST',
    'aa,ab,ae,af,ak,am,an,ar,as,av,ay,az,ba,be,bg,bh,bi,bm,bn,bo,br,bs,ca,ce,ch,co,cr,cs,cu,cv,cy,' +
      'da,de,dv,dz,ee,el,en,eo,es,et,eu,fa,ff,fi,fj,fo,fr,fy,ga,gd,gl,gn,gu,gv,ha,he,hi,ho,hr,ht,hu,' +
      'hy,hz,ia,id,ie,ig,ii,ik,io,is,it,iu,ja,jv,ka,kg,ki,kj,kk,kl,km,kn,ko,kr,ks,ku,kv,kw,ky,la,lb,' +
      'lg,li,ln,lo,lt,lu,lv,mg,mh,mi,mk,ml,mn,mr,ms,mt,my,na,nb,nd,ne,ng,nl,nn,no,nr,nv,ny,oc,oj,om,' +
      'or,os,pa,pi,pl,ps,pt,qu,rm,rn,ro,ru,rw,sa,sc,sd,se,sg,si,sk,sl,sm,sn,so,sq,sr,ss,st,su,sv,sw,' +
      'ta,te,tg,th,ti,tk,tl,tn,to,tr,ts,tt,tw,ty,ug,uk,ur,uz,ve,vi,vo,wa,wo,xh,yi,yo,za,zh,zu'
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

  // --- Trending "TOP" badge ---
  enableTrendingBadge: bool('ENABLE_TRENDING_BADGE', false),
  trendingSource: str('TRENDING_SOURCE', 'tmdb'), // tmdb | mdblist
  trendingTmdbWindow: str('TRENDING_TMDB_WINDOW', 'day'), // day | week
  trendingRefreshIntervalSeconds: num('TRENDING_REFRESH_INTERVAL_SECONDS', 3600),
  trendingBadgeColorStart: str('TRENDING_BADGE_COLOR_START', '#FFD36E'),
  trendingBadgeColorEnd: str('TRENDING_BADGE_COLOR_END', '#F5A623'),

  // MDBList - separate lists for movies/tv. `MDBLIST_*_LIST` is whatever
  // comes after mdblist.com/lists/ in your list's URL, e.g. "username/slug".
  // The exact endpoint MDBList expects isn't fully documented publicly, so
  // this is templated - if requests fail, check the logged URL/status against
  // https://docs.mdblist.com and adjust MDBLIST_LIST_ENDPOINT_TEMPLATE.
  mdblistApiKey: str('MDBLIST_API_KEY', ''),
  mdblistMovieList: str('MDBLIST_MOVIE_LIST', ''),
  mdblistTvList: str('MDBLIST_TV_LIST', ''),
  mdblistListEndpointTemplate: str(
    'MDBLIST_LIST_ENDPOINT_TEMPLATE',
    'https://api.mdblist.com/lists/{list}/items?apikey={apikey}'
  ),

  // --- Bottom status sash ---
  enableStatusSash: bool('ENABLE_STATUS_SASH', false),
  sashHeightPercent: num('SASH_HEIGHT_PERCENT', 8),
  // Below this average luminance (0-255) in the sash's own strip of the
  // poster, the semantic color is swapped for a neutral dark gray instead -
  // avoids garish color-on-dark-poster clashes.
  sashDarkLuminanceThreshold: num('SASH_DARK_LUMINANCE_THRESHOLD', 60),
  recentAddedWindowDays: num('RECENT_ADDED_WINDOW_DAYS', 30), // movies
  airingWindowDays: num('AIRING_WINDOW_DAYS', 14), // tv: "airing" vs "returning"

  sashColorAiring: str('SASH_COLOR_AIRING', '#2563EB'),
  sashColorReturning: str('SASH_COLOR_RETURNING', '#16A34A'),
  sashColorEnded: str('SASH_COLOR_ENDED', '#4B5563'),
  sashColorCanceled: str('SASH_COLOR_CANCELED', '#DC2626'),
  sashColorRecentlyAdded: str('SASH_COLOR_RECENTLY_ADDED', '#DC2626'),
  sashColorDarkFallback: str('SASH_COLOR_DARK_FALLBACK', '#3F3F46'),

  // Badged (composited) posters are cached separately from plain resolved
  // URLs, and for less time, since trending/status data changes over time.
  badgeImageCacheTtlSeconds: num('BADGE_IMAGE_CACHE_TTL_SECONDS', 21600), // 6h
};

if (!config.tmdbApiKey) {
  // eslint-disable-next-line no-console
  console.warn('[config] WARNING: TMDB_API_KEY is not set - TMDB lookups will fail and only Metahub fallback will work.');
}
