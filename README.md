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

## Selection logic (what it actually does)

**Posters & logos:**
1. Look at TMDB images tagged `en` (English).
2. If none (or too few / too low quality — see below), look at TMDB images
   tagged with the title's original language, when that's not already English.
3. If that bracket is also missing/weak, try Metahub.
4. Absolute last resort: best-scoring TMDB image across a broad list of
   languages (`TMDB_ALL_LANGUAGES_FALLBACK_LIST`), ignoring language entirely.

**Backdrops:** same idea, but only ever considers *textless* TMDB backdrops.
TMDB has no explicit "textless" flag — by convention, backdrops with no
burned-in text carry no language tag at all (`iso_639_1 === null`), so that's
what "textless" filters on.

**"Too few / too low quality" (the smart-Metahub trigger):** a bracket
triggers a Metahub check — not just as a last resort — when it has fewer than
`MIN_BRACKET_SIZE` (default 5) eligible images after the resolution filter,
**or** when the scoring pass below never found an image meeting even the
lowest vote-count floor. This was your explicit ask: Metahub shouldn't only
kick in when TMDB has *nothing*, but also when what TMDB has isn't trustworthy.

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
   the most-voted image (then highest average) as a low-confidence fallback,
   which is exactly the case that also triggers a Metahub check.

**Metahub "extra" verification (posters/backdrops only):** before trusting a
Metahub URL, the app does a `HEAD` request and checks `Content-Length` against
`METAHUB_MIN_CONTENT_LENGTH_BYTES`, so a broken/placeholder image on Metahub's
end doesn't get redirected to. Logos skip this check and just use Metahub
directly as a simple last-resort swap-in, since bad logo fallbacks are far
less visually jarring than a broken poster/backdrop.

### Assumptions I made where your spec was open-ended

These are all just `.env` values — tune freely:

- "720p" / "750p" thresholds are interpreted as **pixel width**
  (`MIN_BACKDROP_WIDTH=1280`, `MIN_POSTER_WIDTH=750`), not video resolution.
- "All languages" fallback uses a fixed list of ~30 common ISO-639-1 codes
  (`TMDB_ALL_LANGUAGES_FALLBACK_LIST`) rather than a true unlimited query,
  since TMDB's images endpoint requires you to enumerate languages.
- Backdrops' absolute last-resort fallback (after Metahub also fails) allows
  *any* backdrop regardless of text, not just textless ones — better than a
  404.
- The "resource intensity" knob is `MAX_CONCURRENT_UPSTREAM`, which caps how
  many simultaneous TMDB/Metahub requests the server makes at once. Lower it
  on weaker hardware.

## Caching & concurrency

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
