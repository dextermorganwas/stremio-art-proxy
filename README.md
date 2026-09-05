# stremio-art-proxy

Self-hosted artwork resolver for Stremio's **AIOMetadata** add-on. It exposes
three redirect endpoints — `/poster`, `/backdrop`, `/logo` — that pick the
best available artwork from TMDB (with Cinemeta/Metahub as backup) and
302-redirect the client straight to it. Nothing is proxied/re-uploaded; your
server just decides *which* image URL to send the client to, and caches that
decision.

## How the URLs work

AIOMetadata lets you configure custom art URL templates per-field. Point them
at your server like this (the trailing `?` inside each id tells AIOMetadata
to send a blank instead of dropping the whole URL when that id is missing):

```
Poster:   https://yourdomain.com/poster/tmdb:{type}:{tmdb_id?}&imdb:{imdb_id?}.jpg
Backdrop: https://yourdomain.com/backdrop/tmdb:{type}:{tmdb_id?}&imdb:{imdb_id?}.jpg
Logo:     https://yourdomain.com/logo/tmdb:{type}:{tmdb_id?}&imdb:{imdb_id?}.jpg
```

The id parser doesn't care about order or which ids are present — it also
understands a `tvdb:{tvdb_id}` segment if you want to add that to your
template too. At least one of `tmdb`, `imdb`, or `tvdb` must resolve to a
usable id, or the request 400s.

## Selection logic (what it actually does — per art type, they genuinely differ)

**Posters:**
1. Count *all* eligible TMDB posters across every language (not just
   English/original). If that overall count is below `MIN_BRACKET_SIZE`
   (default 5), TMDB's coverage of this title is judged too thin — try
   Metahub first.
2. Otherwise (or if Metahub had nothing), cascade English → original
   language, taking the best-scoring image in whichever bracket has any
   candidates. No vote-quality gate at this stage — if TMDB's overall
   coverage is healthy, its English-first pick is trusted as-is.
3. If TMDB was thin and Metahub also failed, rank the best candidate from
   *every* bracket against each other (not just whichever was checked
   first) and use the best of those.
4. Absolute last resort: best-scoring poster across a broad list of
   languages (`TMDB_ALL_LANGUAGES_FALLBACK_LIST`).

**Logos:** simple cascade, no quality gate anywhere —
English bracket → original-language bracket → Metahub (only tried when
*both* brackets are completely empty) → best-of-all-languages TMDB logo.

**Backdrops:** only ever considers *textless* TMDB backdrops — at every
single stage, including the final fallback. TMDB has no explicit "textless"
flag; by convention, backdrops with no burned-in text carry no language tag
(`iso_639_1 === null`), so that's what "textless" filters on.
1. Look at textless backdrops. If fewer than `MIN_BRACKET_SIZE` are eligible,
   or none clear the scoring floor below, try Metahub.
2. If that fails, widen to textless backdrops across all languages (still
   textless-only — never falls back to a backdrop with text).
3. If that also fails, use TMDB's low-confidence textless pick rather than
   nothing.

**Scoring ("best" image within a bracket), exactly as you described:**
1. Hard filter: drop anything under `MIN_POSTER_WIDTH` (750px) /
   `MIN_BACKDROP_WIDTH` (1280px, ≈720p landscape width). Never negotiable.
2. Starting at `VOTE_FLOOR_START` (10) votes: keep only images with at least
   that many votes, then take the highest `vote_average` among them. Past
   this floor we stop caring how much higher the vote count goes — only the
   average distinguishes.
3. If nothing has that many votes, step the floor down by `VOTE_FLOOR_STEP`
   (2) and retry, down to `VOTE_FLOOR_MIN` (4).
4. If even that finds nothing, we no longer trust the vote data at all: pick
   the most-voted image (then highest average) as a low-confidence fallback.
   For backdrops only, this low-confidence result is still what triggers a
   Metahub check (posters no longer use vote-quality as a Metahub trigger —
   only overall thinness does, per your request).

**Metahub "extra" verification (posters/backdrops only):** before trusting a
Metahub URL, the app does a `HEAD` request and checks `Content-Length` against
`METAHUB_MIN_CONTENT_LENGTH_BYTES`, so a broken/placeholder image on Metahub's
end doesn't get redirected to. Logos skip this check.

### Assumptions I made where your spec was open-ended

These are all just `.env` values — tune freely:

- "720p" / "750p" thresholds are interpreted as **pixel width**
  (`MIN_BACKDROP_WIDTH=1280`, `MIN_POSTER_WIDTH=750`), not video resolution.
- "All languages" fallback enumerates the full ISO-639-1 code list
  (`TMDB_ALL_LANGUAGES_FALLBACK_LIST`). TMDB's images endpoint has no
  wildcard for `include_image_language` - confirmed via TMDB's own dev
  forum, where a "give me every language" option was requested and never
  added - so enumerating every code is the only way to get true broad
  coverage.
- Backdrops' absolute last-resort fallback (after Metahub also fails) allows
  *any* backdrop regardless of text, not just textless ones — better than a
  404.
- The "resource intensity" knob is `MAX_CONCURRENT_UPSTREAM`, which caps how
  many simultaneous TMDB/Metahub requests the server makes at once. Lower it
  on weaker hardware.

## Trending badge & status sash (posters only)

Both are opt-in (`ENABLE_TRENDING_BADGE` / `ENABLE_STATUS_SASH`, off by
default) and **only apply to posters** — Stremio has no way to overlay
badges itself, so when either is on, the poster route stops redirecting and
instead downloads the resolved poster, draws the badge(s) on top with
`sharp`, and serves the composited image bytes directly (cached separately,
`BADGE_IMAGE_CACHE_TTL_SECONDS`, default 6h, shorter than the normal art
cache since trending/status data changes over time). Backdrops and logos are
untouched either way.

**Trending badge:** a small gold "TOP" pill with a flame icon, top-left
corner. Source is switchable:
- `TRENDING_SOURCE=tmdb` (default): TMDB's own daily/weekly trending list.
- `TRENDING_SOURCE=mdblist`: your own MDBList list(s) - `MDBLIST_MOVIE_LIST`
  and `MDBLIST_TV_LIST` separately, since a list is normally one media type.
  **Caveat:** MDBList doesn't have a single fully-public API reference, so
  the request shape here (`MDBLIST_LIST_ENDPOINT_TEMPLATE`) is my best
  reconstruction from their list URL format and third-party tool docs, not
  a verified spec. If it doesn't return anything, check the warning it logs
  (includes the exact URL and HTTP status) against
  [docs.mdblist.com](https://docs.mdblist.com) and adjust the template in
  `.env` - no code change needed.

**Status sash:** a thin bar across the bottom - Airing / Returning / Ended /
Canceled for TV (from TMDB's `status` field, with Airing vs Returning split
by how close the nearest episode is, `AIRING_WINDOW_DAYS`), or Recently Added
for movies (TMDB has no "added to your library" concept, so this uses
release-date recency, `RECENT_ADDED_WINDOW_DAYS`, as the closest proxy).
Colors per status are set in `.env` (`SASH_COLOR_*`). Before drawing it, the
app samples the poster's own pixels in that bottom strip - if the poster is
already dark there, it uses a neutral dark gray (`SASH_COLOR_DARK_FALLBACK`)
instead of the semantic color, so a bright blue/green bar doesn't clash with
a moody dark poster.

Font is a bold sans-serif (Helvetica/Arial family) rather than an exact match
to your reference images' font (likely San Francisco), since embedding
Apple's font isn't something I can bundle here - visually close, not
pixel-identical. The flame icon is a simple drawn vector shape rather than
an emoji glyph, since emoji fonts aren't reliably present in the Alpine
container. If either looks off once deployed, it's a quick tweak in
`src/services/imageCompose.ts` (font-family / SVG path) - let me know what
you see and I can adjust it precisely.



- Every resolved art URL is cached for `CACHE_TTL_SECONDS` (default 7 days),
  keyed by art type + whichever ids were supplied.
- Raw TMDB responses (details + images) are cached separately per TMDB id and
  **shared** across poster/backdrop/logo requests for the same title, so
  AIOMetadata's three separate calls for one item cost one TMDB round trip,
  not three.
- **Simultaneous identical requests** (e.g. Stremio re-requesting art for the
  same item from two devices at once) are de-duplicated in-memory — the
  second request just awaits the first one's in-flight result instead of
  hitting TMDB/Metahub again.
- `CACHE_BACKEND=disk` persists the cache to `CACHE_DIR` so it survives
  container restarts; `memory` (default) is faster but resets on restart.

## Configuration

See [`.env.example`](.env.example) for the full list with comments. Copy it
to `.env` and edit before deploying.

## Running locally (without Docker)

```bash
npm install
cp .env.example .env   # then edit .env
npm run dev
```

### Generating the lockfile (do this once, before your first Docker build)

The Docker build uses `npm ci`, which requires a `package-lock.json` to be
present and installs exactly the versions it records - this is what makes
builds reproducible instead of silently picking up newer dependency versions
over time. This repo doesn't ship one yet (it was written without network
access), so before your first build:

```bash
npm install          # generates/updates package-lock.json
```

Then commit `package-lock.json` (via GitHub Desktop, same as any other file)
and push. From then on, only re-run `npm install` and commit the updated
lockfile when you deliberately want to bump a dependency version.

## Deploying with Docker Compose (pulling from GHCR)

```bash
mkdir -p stremio-art-proxy && cd stremio-art-proxy
# put docker-compose.yml and .env here (see below for getting them)
docker compose up -d
```

`docker-compose.yml` pulls `ghcr.io/<owner>/<repo>:latest` — see the GitHub
setup walkthrough below for how that image gets built and published
automatically every time you push.

---

## Step-by-step: getting this onto GitHub and building it into a GHCR image

You mentioned you have GitHub Desktop but haven't used it — here's the whole
path from zero to a working `ghcr.io` image, no command line required beyond
what's in this doc.

### 1. Create the repository on GitHub.com

1. Go to https://github.com and sign in (create a free account if needed).
2. Click the **+** icon top-right → **New repository**.
3. Name it something like `stremio-art-proxy`.
4. Leave it **Public** (simplest — a public repo's GHCR package is free and
   pullable with no login on your Docker server; Private also works but needs
   an extra login step on the server, covered below).
5. Don't check "Add a README" — you already have one. Click **Create
   repository**.

### 2. Clone it with GitHub Desktop

1. Open GitHub Desktop → sign in with the same GitHub account (**File → Options
   → Accounts**, or it'll prompt you on first launch).
2. **File → Clone Repository** → pick your new `stremio-art-proxy` repo from
   the list → choose a local folder (e.g. `Documents\GitHub\stremio-art-proxy`)
   → **Clone**.
3. This creates an empty local folder linked to your GitHub repo.

### 3. Add the project files

1. Take everything from the zip I've given you and copy it **into** that
   cloned folder (so `Dockerfile`, `src/`, `package.json`, etc. sit directly
   inside `stremio-art-proxy/`, alongside the hidden `.git` folder GitHub
   Desktop created).
2. Do **not** copy your real `.env` into git — only `.env.example` should be
   committed (the `.gitignore` already excludes `.env`).

### 4. Commit and push with GitHub Desktop

1. Switch back to GitHub Desktop — it will automatically detect all the new
   files under the **Changes** tab.
2. At the bottom left, type a commit summary, e.g. `Initial commit`.
3. Click **Commit to main**.
4. Click **Push origin** at the top (this uploads your commit to GitHub.com).

### 5. Let GitHub Actions build and publish the image

Because the repo includes `.github/workflows/docker-publish.yml`, pushing to
`main` automatically triggers a build and publishes the image to GHCR —
nothing else to configure, it uses GitHub's built-in `GITHUB_TOKEN`.

1. On GitHub.com, open your repo → the **Actions** tab.
2. You should see a run called "Build and Publish Docker Image" — click it to
   watch progress. It builds for both `amd64` and `arm64` and takes a few
   minutes the first time.
3. Once it's green, go to your repo's main page → the **Packages** panel on
   the right sidebar (or https://github.com/users/YOUR_USERNAME/packages) →
   you'll see `stremio-art-proxy` listed with a `latest` tag.

### 6. Make sure the package is pullable from your Docker server

If your repo is **public**, the package is public and pullable with no login.
If it's **private**, either:
- make the package itself public (Package settings → Change visibility), or
- on your Docker server, run `docker login ghcr.io -u YOUR_USERNAME` using a
  [Personal Access Token](https://github.com/settings/tokens) with
  `read:packages` scope as the password, once, before `docker compose up`.

### 7. Deploy on your Docker Linux server

1. Copy `docker-compose.yml` and `.env.example` to a folder on the server,
   e.g. `/opt/stremio-art-proxy/`.
2. Rename `.env.example` to `.env` and fill in `TMDB_API_KEY` (get one free
   at https://www.themoviedb.org/settings/api) plus any other values you want
   to tweak.
3. Edit `docker-compose.yml`, replacing `ghcr.io/<owner>/<repo>` with your
   actual `ghcr.io/YOUR_USERNAME/stremio-art-proxy`.
4. From that folder:
   ```bash
   docker compose pull
   docker compose up -d
   ```
5. Confirm it's alive: `curl http://localhost:3000/health` should return
   `{"status":"ok"}`.
6. Point your reverse proxy (if any) at port 3000, then plug the URL
   templates from the top of this README into AIOMetadata's poster/backdrop/
   logo custom URL fields.

### Updating later

Any time you push a new commit to `main` (via GitHub Desktop: edit files →
Commit → Push), Actions rebuilds and republishes `latest` automatically. On
the server, just re-run:
```bash
docker compose pull && docker compose up -d
```
