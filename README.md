<p align="center">
  <img src="public/assets/svg/favicon.svg" width="72" alt="">
</p>
<h1 align="center">THE SIR ARCHIVES</h1>
<p align="center"><em>An absurdly over-engineered, cinematic, interactive birthday roast for Shreaysh Shenal Munda — a.k.a. SIR.</em></p>
<p align="center">
  Cinematic intro · FBI-style dossier · fake scouting report · Three.js stadium · awards ceremony · gaming HUD · anime engine · fake academic dashboard · gym chronicles · food division · backend-powered roast generator · 16-photo evidence room · documentary timeline · boss fight · AI terminal · one (1) compliment · 3D cake · message wall · cinematic ending · 12 easter eggs · hidden admin panel
</p>

---

## Table of contents

1. [What this is](#1-what-this-is)
2. [Architecture](#2-architecture)
3. [Install dependencies](#3-install-dependencies)
4. [Run locally](#4-run-locally)
5. [Start the backend (and only the backend)](#5-start-the-backend)
6. [Adding photos](#6-adding-photos)
7. [Editing configuration & content](#7-editing-configuration--content)
8. [Environment variables](#8-environment-variables)
9. [Building the frontend](#9-building-the-frontend)
10. [Deploying the frontend](#10-deploying-the-frontend)
11. [Deploying the backend](#11-deploying-the-backend)
12. [Connecting the database](#12-connecting-the-database)
13. [Admin panel](#13-admin-panel)
14. [API reference](#14-api-reference)
15. [Easter eggs](#15-easter-eggs)
16. [Checks, tests, troubleshooting](#16-checks-tests-troubleshooting)

---

## 1. What this is

A single-page cinematic website (HTML/CSS/JS + GSAP + ScrollTrigger + Three.js) served by a small Node/Express backend with a SQLite database. The backend is not decoration — it powers:

| Feature | Backend role |
|---|---|
| Roast generator | Combines setup + punchline + callback fragments server-side from an editable library, avoids repeats per visitor, stores every generated roast and global counters |
| Evidence room / hero photo | Photo metadata (titles, captions, tags, order) and file-existence checks; view counts |
| Boss fight | Stores scores, computes rank, serves a leaderboard; HP / damage / regen / time limit are server settings |
| Easter eggs | 12 eggs tracked per visitor and globally |
| Birthday messages ("Transmissions") | Real guestbook with validation, rate limiting and optional approval |
| Timeline, awards, profile, settings | Fully editable from the admin panel without touching code |
| Visitor & interaction stats | Sessions, sections seen, intro completion, reaching the end, every key interaction |
| Hidden admin dashboard | `/admin`, protected by an environment-variable password |

Everything is friendly roasting of his habits (late, lazy, anime, exams as obvious comedy, missing perfect passes, "unnational", gaming rage, biryani). Nothing about protected characteristics, no revealing photos.

## 2. Architecture

```
no_lag_here/
├─ server/                 Express app (CommonJS)
│  ├─ index.js             app + static hosting + vendor routes + error handling
│  ├─ db.js                SQLite (better-sqlite3), schema, settings helpers
│  ├─ seed.js              idempotent seeding from /config (+ --reset)
│  ├─ lib/auth.js          admin password check (timing-safe) + HMAC session tokens
│  ├─ lib/validate.js      input validation helpers
│  ├─ lib/rateLimit.js     in-memory per-IP limiter
│  ├─ lib/roastEngine.js   setup+punchline+callback combiner
│  └─ routes/public.js     /api/*      routes/admin.js   /api/admin/*
├─ config/                 SEED CONTENT you edit: profile, photos, roasts, timeline, awards, easterEggs, settings
├─ public/                 the frontend (no build step)
│  ├─ index.html           shell with one <section> mount per scene
│  ├─ css/base.css         design tokens + shared components   css/hud.css   css/fonts.css (self-hosted fonts)
│  ├─ css/sections/*.css   one stylesheet per scene
│  ├─ js/main.js           bootstrap: session → data → intro → HUD → sections → observers
│  ├─ js/core/             api, state, sfx (synthesized Web Audio), motion (GSAP helpers), eggs, viewer, particles, three-utils, intro, hud, ui
│  ├─ js/sections/*.js     one ES module per scene (see docs/SECTION-CONTRACT.md)
│  ├─ assets/photos/       YOUR PHOTOS (+ /thumbs, generated)   assets/fonts/   assets/svg/
│  └─ admin/               hidden dashboard (index.html, admin.css, admin.js)
├─ scripts/                sync-photos, optimize-photos, check
├─ tests/api.test.js       backend tests (node --test)
├─ data/                   SQLite file lives here (git-ignored)
├─ Dockerfile · render.yaml · fly.toml · .env.example
└─ docs/SECTION-CONTRACT.md  how sections are built
```

Libraries (GSAP, ScrollTrigger, ScrollToPlugin, Three.js) are installed with npm and served by Express from `node_modules` at `/vendor/…` — no CDN, no bundler, works offline. Fonts are self-hosted.

## 3. Install dependencies

### Ubuntu / Debian quickstart

```bash
# 1. Node.js 22 (skip if `node -v` already says v20+)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git

# 2. Build tools — only needed if npm has to compile better-sqlite3/sharp (prebuilt binaries usually download fine)
sudo apt-get install -y build-essential python3

# 3. Get the code and install
git clone https://github.com/shivxoxo/no_lag_here.git
cd no_lag_here
git checkout claude/beautiful-mendel-5ayce9
npm install

# 4. Configure + run
cp .env.example .env
nano .env                 # set ADMIN_PASSWORD=something-long (8+ chars), save with Ctrl+O, Enter, Ctrl+X
npm start                 # → http://localhost:3000   admin → http://localhost:3000/admin
```

Open it on your phone on the same Wi-Fi with `http://<your-pc-ip>:3000` (find the IP with `hostname -I`). To share it on the internet without deploying, run `npx localtunnel --port 3000` in a second terminal or use ngrok.

### Any OS

Requirements: **Node.js 20+** (22 recommended) and npm.

```bash
git clone <this repo>
cd no_lag_here
npm install            # installs express, better-sqlite3, gsap, three (+ sharp as a dev dependency for photo optimization)
```

`better-sqlite3` and `sharp` download prebuilt binaries. If `sharp` fails on your machine it does not matter for running the site — it is only used by `npm run photos:optimize`. Install without it: `npm install --omit=dev`.

## 4. Run locally

```bash
cp .env.example .env     # then edit ADMIN_PASSWORD (8+ characters)
npm start                # → http://localhost:3000
```

Dev mode with auto-restart on server changes: `npm run dev`.

On first start the database is created at `data/sir-archives.db` and seeded from `config/`. The site is at `/`, the admin panel at `/admin`.

## 5. Start the backend

The same process serves both the frontend and the API — there is nothing else to start. If you host the frontend elsewhere (see §10) and only want the API:

```bash
CORS_ORIGINS=https://your-frontend.example npm start
```

The API is under `/api/*`, health check at `/api/health`.

## 6. Adding photos

1. Copy images into **`public/assets/photos/`** (jpg/png/webp). Any number — the gallery, viewer, random mode and evidence board handle 15+ (currently 16).
2. Optimize + generate thumbnails (recommended, needs `sharp`):
   ```bash
   npm run photos:optimize        # rotates via EXIF, resizes to max 1600px, writes /thumbs (520px)
   ```
3. Register them — pick one:
   - **Config array** (`config/photos.js`) — this is the "simple configuration array" from the brief:
     ```js
     { src: 'photo17.jpg', title: 'Evidence #017', caption: 'Bro really thought this was a good idea.', tags: ['football'] },
     ```
     New entries are picked up automatically on the next start **if the photos table is still empty**; otherwise run `npm run photos:sync` (adds files that are on disk but not in the DB) or `npm run seed:reset` (wipes admin edits and reloads everything from config).
   - **Admin panel** → Photos → "Scan folder" (adds new files with placeholder captions), then edit captions/titles/tags/order inline.
4. The hero photo is chosen in Admin → Profile (`hero_photo`) or `config/profile.js`.

Files listed in the DB but missing on disk are hidden from the site and flagged in the admin panel. Photos tagged `food` show up in the Food Division; `hero` marks the intro photo.

## 7. Editing configuration & content

| What | Where |
|---|---|
| Name, age, nickname, birthday, position, habits, friends, tagline, hero photo | `config/profile.js` (seed) → Admin → Profile (live) |
| Roast lines (one-liners, setups, punchlines, callbacks; topics) | `config/roasts.js` → Admin → Roasts |
| Timeline events | `config/timeline.js` → Admin → Timeline |
| Awards | `config/awards.js` → Admin → Awards |
| Easter egg names/hints | `config/easterEggs.js` → Admin → Easter Eggs |
| Boss HP/damage/regen/time, sound default, message approval, compliment on/off, video evidence file | `config/settings.js` → Admin → Settings |
| Photo captions/labels | `config/photos.js` → Admin → Photos |

Seeding rules: `npm start` only fills **empty** tables (your admin edits survive restarts and deploys). `npm run seed:reset` reloads content tables from `config/` (stats, scores, messages and egg finds are kept).

## 8. Environment variables

Copy `.env.example` → `.env`:

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `PORT` | no | `3000` | HTTP port |
| `DATABASE_PATH` | no | `./data/sir-archives.db` | SQLite file location (point it at a persistent disk in production) |
| `ADMIN_PASSWORD` | **yes for /admin** | – | Admin login. Must be ≥ 8 chars. Never hardcoded, never sent to the browser. If unset, `/admin` is disabled (503). |
| `SESSION_SECRET` | no | random per boot | Signs admin session tokens; set it so admin sessions survive restarts |
| `ADMIN_SESSION_HOURS` | no | `12` | Admin token lifetime |
| `CORS_ORIGINS` | no | – | Comma-separated origins allowed to call the API cross-origin (only when the frontend is hosted separately) |
| `NODE_ENV` | no | `development` | `production` enables long cache headers for static files |

## 9. Building the frontend

There is **no build step**. The frontend is plain ES modules + CSS served as-is (vendor libraries come from `node_modules` through `/vendor/…`). Nothing to compile, nothing to bundle.

If you want to host the frontend statically (§10) you need a copy of the vendor files next to it:

```bash
mkdir -p dist && cp -r public/* dist/
mkdir -p dist/vendor/gsap dist/vendor/three/jsm
cp node_modules/gsap/dist/{gsap,ScrollTrigger,ScrollToPlugin}.min.js dist/vendor/gsap/
cp node_modules/three/build/three.module.js dist/vendor/three/
cp -r node_modules/three/examples/jsm/* dist/vendor/three/jsm/
```

## 10. Deploying the frontend

**Recommended: don't split it.** Deploy the whole thing as one Node service (§11) — Express serves the frontend, the photos and the API from one origin, and everything works out of the box.

**Optional split** (frontend on Firebase Hosting / Netlify / Vercel / GitHub Pages, backend elsewhere):

1. Produce `dist/` as in §9.
2. In `dist/index.html`, before the `<script type="module" src="js/main.js">` tag add
   `<script>window.SIR_API_BASE = 'https://your-api.example';</script>`
3. Set `CORS_ORIGINS=https://your-frontend.example` on the backend.
4. Firebase Hosting example: `npm i -g firebase-tools && firebase init hosting` (public dir `dist`, single-page app "yes"), then `firebase deploy`.

Why not Firebase for the backend? Firebase would need Cloud Functions + Firestore to replace Express + SQLite — a second, different stack for no gain at this scale. One coherent architecture (Express + SQLite on a persistent disk) is simpler, cheaper and easier to edit. The static-frontend split above is the only Firebase piece that makes sense.

## 11. Deploying the backend

Any host that runs Node with a persistent disk. The repo ships ready-made configs:

### Render (easiest)
1. Push the repo to GitHub, click **New → Blueprint**, pick the repo (it reads `render.yaml`).
2. Set `ADMIN_PASSWORD` in the dashboard. Deploy.
3. The disk is mounted at `/var/data`, `DATABASE_PATH` already points there.

### Fly.io
```bash
fly launch --copy-config --no-deploy
fly volumes create sir_data --size 1
fly secrets set ADMIN_PASSWORD='something-long' SESSION_SECRET="$(openssl rand -hex 32)"
fly deploy
```

### Docker (any VPS)
```bash
docker build -t sir-archives .
docker run -d -p 3000:3000 -v sir-data:/data -e ADMIN_PASSWORD='something-long' --name sir sir-archives
```

### Railway / Heroku-style
Build: `npm ci --omit=dev` · Start: `node server/index.js` · attach a volume and set `DATABASE_PATH` to it · set `ADMIN_PASSWORD`.

### Bare VPS with pm2
```bash
npm ci --omit=dev
pm2 start server/index.js --name sir-archives
```
Put nginx/Caddy in front for HTTPS (the app sets `trust proxy`).

## 12. Connecting the database

SQLite needs no server: the file at `DATABASE_PATH` **is** the database, created and migrated automatically on boot (`server/db.js`, WAL mode). Rules:

- In production point `DATABASE_PATH` at a **persistent volume** (Render disk, Fly volume, Docker volume). Ephemeral filesystems lose the DB on every deploy.
- Back it up by copying the file (`sqlite3 data/sir-archives.db ".backup backup.db"` or just `cp` while the app is stopped).
- Tables: `profiles, photos, roasts, roast_history, timeline, awards, messages, visitors, game_scores, easter_eggs, easter_egg_finds, events, settings`.
- Inspect it: `npx sqlite3 data/sir-archives.db` or any SQLite GUI.
- Want Postgres later? Everything DB-related is in `server/db.js` + the two route files; the SQL is standard.

## 13. Admin panel

`http://localhost:3000/admin` → enter `ADMIN_PASSWORD`. Sessions are HMAC-signed bearer tokens kept in `sessionStorage`; login is rate-limited (8 tries / 15 min). Tabs: Overview (visitors, roasts, scores, sections, charts), Profile, Roasts (+ generated history), Timeline, Awards, Photos (scan folder, captions, order, missing-file flags), Messages (approve/delete), Scores, Easter Eggs, Settings, Danger Zone (reset statistics).

## 14. API reference

Public (all JSON; send `X-Visitor-Id` after `/visit`):

| Method | Path | Purpose |
|---|---|---|
| POST | `/api/visit` | create/refresh visitor session → `{visitor_id}` |
| GET | `/api/bootstrap` | profile + photos + timeline + awards + settings + stats + easter eggs (one call) |
| GET | `/api/profile` · `/api/photos` · `/api/timeline` · `/api/awards` · `/api/settings` · `/api/stats` | individual resources |
| POST | `/api/roast` `{topic?}` | generate a roast (setup + punchline + callback) |
| GET | `/api/roasts` · `/api/roasts/history?limit=` | library summary / recent generated roasts |
| GET/POST | `/api/messages` · `/api/message` `{name,message}` | birthday message wall |
| POST | `/api/game-score` `{game,score,won,duration_ms,player,meta}` | store a score → rank |
| GET | `/api/game-scores?game=boss&limit=10` | leaderboard |
| GET/POST | `/api/easter-eggs` · `/api/easter-egg` `{key}` | list / unlock |
| POST | `/api/event` `{type,meta}` | interaction analytics (whitelisted types) |
| POST | `/api/photos/:id/view` | count a photo view |
| GET | `/api/health` | health check |

Admin (`Authorization: Bearer <token>`): `POST /api/admin/login`, `GET /api/admin/stats`, `GET/PUT /api/admin/profile`, CRUD `/api/admin/roasts|timeline|awards|photos` (+ `/reorder`, `/photos/scan`), `GET /api/admin/roast-history`, `GET/PUT/DELETE /api/admin/messages/:id`, `GET/DELETE /api/admin/scores/:id`, `GET/PUT /api/admin/easter-eggs/:key`, `GET/PUT /api/admin/settings`, `POST /api/admin/reset-stats`.

All input is validated (`server/lib/validate.js`), write endpoints are rate-limited, JSON bodies are capped at 64 KB, secrets (admin password, egg solutions) are never sent to the public frontend.

## 15. Easter eggs

12, tracked per visitor. Hints are shown on the site (press `?`); solutions are in `config/easterEggs.js` and the admin panel. Don't tell him.

## 16. Checks, tests, troubleshooting

```bash
npm run check      # verifies assets, section modules, photos on disk, DB init
npm test           # backend API tests (temporary database)
```

- **`/admin` says disabled** → set `ADMIN_PASSWORD` (≥ 8 chars) in `.env` and restart.
- **Photos don't show** → file must be in `public/assets/photos/` AND registered (config, `npm run photos:sync`, or Admin → Scan). Check Admin → Photos for "FILE MISSING".
- **Sound is silent** → browsers require a click first; use the SOUND button in the HUD (also in the intro). Sounds are synthesized, no audio files.
- **Everything is static / no animation** → the visitor (or OS) enabled reduced motion; the HUD MOTION button overrides it.
- **Backend offline toast** → the frontend still renders with fallback content but nothing is saved.
- **Stats reset on deploy** → your `DATABASE_PATH` is on an ephemeral disk; mount a volume (§12).

Made by Shiv + Alex. With friendship, chaos, and absolutely zero mercy.
