# CLAUDE.md

Context for Claude (and humans) working in this repo. Read this first, then `docs/functioneel-ontwerp.md`.

## What this is

A PWA for first-aid (EHBO) coordination at events. First use: **Silvesterloop Poppenwier, Thursday 31 December 2026** (Kidsrun + 5/10/21 km run/walk, start at Eetcafé De Trilker, ~15 posts, ~20 staff, 2–3 EHBO units).

- Staff install the app on their home screen and log in with their phone number. Participants open it without installing and only see route, posts and start times.
- Everyone on staff sees all posts and contacts and can call or navigate to them.
- A post taps **EHBO**, which alerts the nearest free EHBO unit. After 30 s with no acceptance it goes to all free units; the first to accept gets it. The event coordinator gets a copy of every call.
- Other requests (water, traffic, volunteer) go to the coordinator's queue.
- After the event an admin exports a report (PDF and CSV).

UI language is **Dutch**. Code, identifiers and commit messages are English.

## Where things are

| Path | What |
| --- | --- |
| `docs/functioneel-ontwerp.md` | Full functional design and **all decisions**. The source of truth; update it when a decision changes. |
| `docs/design/index.html` | Gallery of all 31 screens in process order. `docs/design/screens/*.html` are the per-screen references to build from. |
| `docs/design/source/` | Original design canvas, for re-import into Claude. Don't edit by hand. |
| `src/`, `public/`, `test/` | **Current test version** (phase 1): install check + Web Push, zero dependencies. |
| `.github/workflows/build.yml` | Test → build → smoke test → push to GHCR → clean old images. |
| `unraid/`, `docker-compose.yml` | Deployment. |

## Status (28 Oct 2026)

- Design finished; no open questions.
- Phase 1 (test version) is live at https://silvesterloop.groveld.com. Install and push work on Windows and iPhone. Android is not tested yet.
- Known deployment issue, parked by the owner: the Unraid template maps `/config` and port 5000, but the app uses `/data` and 8080. Data and VAPID keys are lost on update until this is fixed. Fix the template (`/data`, `--user 99:100`, chown appdata), or make the image follow PUID/PGID//config.
- Next: phase 2 in the work plan, "Basis en beheer". Migrate to the chosen stack below.

## Chosen stack (decided 28 Oct 2026)

- **TypeScript** everywhere. Monorepo layout `server/`, `web/`, `shared/` (shared types and fixed lists).
- **web:** Vue 3, Vite and Pinia. Own service worker for the offline shell and event package. MapLibre GL with OSM vector tiles as **PMTiles**, served from our own server and cached offline.
- **server:** Node 22 and Fastify, in one container. It holds the API, call logic, escalation timers and report. **SQLite with one file per event**, WAL mode, behind a single data-access layer so Postgres stays possible.
- **Live updates:** Server-Sent Events with a heartbeat every 30 s. Cloudflare drops idle connections after 100 s.
- **Push:** our own Web Push module (VAPID ES256 and aes128gcm), already in `src/webpush.js` and tested against the RFC 8291 vector. Reuse it; don't add `web-push`.
- **Tests:** `node:test` for units, Playwright end-to-end in CI for the call chain (login → request → call → close).
- **Report:** CSV, plus a print-friendly page saved as PDF.

The test version has zero npm dependencies only because the sandbox it was built in had no registry access. The real build may use npm normally.

## Infrastructure

- Image `ghcr.io/groveld/ehbo-app:latest`, built on every push to `main`. Tags `v*` also produce semver tags.
- Unraid with Docker on network `proxynet`, container `ehbo-app`, port 8080. Appdata `/mnt/user/appdata/ehbo-app` maps to `/data`, which holds the DB and VAPID keys, so back it up. Unraid auto-updates nightly.
- **From week 52, freeze the image** (pin `:sha-…` or a version, or turn off auto-update), so nothing ships unnoticed on 31 Dec.
- Reachable only via Cloudflare Tunnel: `silvesterloop.groveld.com` → `http://ehbo-app:8080`. All caching is off for the hostname. No Cloudflare Access (it breaks install and push). Rocket Loader is off.
- The server needs outbound HTTPS to the push services (Apple, FCM, Mozilla).

## Design rules (keep screens consistent)

- **Theme:** neutral event theme. Anthracite `#16181D` with yellow accent `#F2C230`, background `#F6F5F1`, font IBM Plex Sans (Plex Mono for numbers).
  - The theme can be configured per event: large logo, square logo used as app icon, and colors.
- **Signal colors** are fixed and never themed: red `#C8261E` for urgent, green `#0A7D4F` for OK. Each post type has its own color and letter.
- **Colored header blocks** (call, sent, en route, stand-by, no signal): always 140 px tall, text top-aligned, title 26 px.
- **Buttons:**
  - Primary: 56 px tall, 16 px bold.
  - Secondary: 48 px.
  - Icon button: 44 × 44.
  - Two buttons side by side are always the same height.
- **112** is always at the bottom of the screen, in the same place. The app never replaces 112.
- The request tiles on the post home screen are deliberately large; this is the one exception to the button sizes.
- **"Post sluiten"** is a small, subtle red button at the top right, so it can't be confused with closing the screen.
- Phone frame 390 × 844. Check every new screen against `docs/design/screens/`.

## Key behaviour (details in the design doc)

- **Roles** follow from the phone number:
  - listed at a post → staff;
  - at an EHBO post or unit → EHBO;
  - kernteam → shown at the top of the overview;
  - on the admin list → admin.
  - One person can hold several roles.
  - An admin can't remove their own number.
- **Nearest unit** = straight-line distance, which works offline. Only units with status *free* count.
  - Fixed unit: its own EHBO post.
  - Mobile unit: last GPS fix (shared every minute while on duty), otherwise its standplaats post.
- **AED rule:** when the person is not responsive, the call goes to the nearest free unit and the nearest free AED unit at once.
- **Statuses:** reported → sent → accepted → on site (one tap) → closed, or withdrawn. Every step is timestamped.
- **No signal:** maps, contacts, calling and navigating all work offline. The help button falls back to calling the nearest EHBO unit and the coordinator directly.
- **Privacy:** no casualty names or medical details are stored. Positions are not stored.

## Commands (test version)

```sh
npm test       # node --test, includes the RFC 8291 vector
npm run dev    # http://localhost:8080, data in ./data
npm run icons  # regenerate icons (Python + Pillow)
```

Requires Node ≥ 22.13 (`node:sqlite`). For browser testing without installing, open `/?browser=1`.

## Conventions

- GitHub Actions follow the owner's existing workflow style (pinned action versions, GHCR, cleanup keeping 5 untagged). Dependabot updates actions and the Docker base image weekly.
- Keep `README.md` (Dutch, operator-facing: setup, Unraid, Cloudflare, phone test list) up to date when deployment changes.
- When a decision changes, update the **Besluiten** table in `docs/functioneel-ontwerp.md` in the same commit.
- Small, focused commits. Tests must pass, and CI runs a container smoke test before publishing.
