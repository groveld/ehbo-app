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
| `server/` | Fastify server (TypeScript, run directly by Node). `src/app.ts` wires it up; `src/routes/` the API; `src/event-db.ts` the per-event data-access layer with migrations; `src/roles.ts` phone number → roles; `src/auth.ts` sessions; `src/db.ts` server settings (VAPID keys); `src/webpush.ts` our own Web Push; `src/demo.ts` fictional test data (`npm run seed`). Tests in `test/`. |
| `web/` | Vue 3 + Vite + Pinia + Vue Router app. One file per screen in `src/views/`, named after the design screen. `src/sw.ts` is the service worker, built as `/sw.js` by the plugin in `vite.config.ts`. Icons and manifest in `public/`. |
| `shared/` | Types and fixed lists used by both server and web (`@ehbo/shared`). |
| `.github/workflows/build.yml` | Test → build → smoke test → push to GHCR → clean old images. |
| `unraid/`, `docker-compose.yml` | Deployment. |

## Status (28 Oct 2026)

- Design finished; no open questions.
- Phase 1 (test version: install check + Web Push) is **done**, tagged `v0.2.0`. It runs on the chosen stack below at https://silvesterloop.groveld.com. Install and push are confirmed on Windows, iPhone and Android.
- The Unraid container uses `/data`, `--user 99:100` and port 3000, so data and VAPID keys survive updates.
- Phase 2, "Basis en beheer", is done (PRs 2a, 2b, 2c and style):
  - **2a**: data model for all of phase 2, phone-number login with roles, screens 2.1–2.7, temporary start screen. Merged and live.
  - **2b**: admin API and screens 1.1–1.5 plus a post list, in `web/src/views/admin/`. Merged and live. Style and logos (1.1 "Stijl", 1.6) are a separate step after 2c.
  - **2c**: event package (`server/src/routes/package.ts`), offline map (`server/src/map.ts`, `routes/map.ts`, `web/src/components/EventMap.vue`, `stores/package.ts`), overview with tabs (`web/src/views/overzicht/`), post detail (3.5), participant view (2.8), map picking in the post form, menu with navigation-app choice. Merged and live.
  - **Style and logos**: 1.1 "Stijl" and 1.6 (`web/src/views/admin/AppIcoonView.vue`). Colors and short name in `event.style_json`; logos as PNG in `brand_images` (`server/src/brand.ts`, `routes/brand.ts`), served at `/brand/<name>.png`, with a redirect to `/icons/…` when there is no own logo. The browser resizes uploads (`web/src/images.ts`); `web/src/theme.ts` sets `--primary`/`--accent`. The manifest is built by the server, not a file in `web/public/`.
- Now: phase 3, "EHBO-verzoek en meldingen", in three PRs (decided 28 Oct; post open/close moved here from phase 4):
  - **3a** (branch `feat/phase3a-calls`): the call engine on the server. `server/src/calls.ts` (dispatch, escalation, AED, accept, on site, close, withdraw, assign, availability, positions), `routes/calls.ts` (API and SSE at `/api/live`), `notify.ts` (push to all devices of a person). Types in `shared/src/incident.ts`. Tests in `test/calls.test.ts` use a manual scheduler and capture pushes.
  - **3b** (branch `feat/phase3b-screens`, on top of 3a): post home 3.1/3.2 (`PostHomeView`), EHBO request and details 4.1 (`EhboVerzoekView`), sent/help on the way 4.2/4.6 plus manual assign for the coordinator (`MeldingView`), stand-by 3.3 (`StandbyView`), call/all units/already taken/en route 4.3–4.7 (`OproepView`), closing 4.8 (`AfrondenView`). Live state in `web/src/stores/live.ts` (SSE, actions, GPS sharing for mobile units); `components/StatusBlock.vue` is the 140 px header. Open calls are red on the map and in the Verzoeken tab.
  - **3c**: no-signal fallback (4.9), resending offline requests, repeating alarm in the app, Playwright end-to-end test.

## Chosen stack (decided 28 Oct 2026)

- **TypeScript** everywhere. Monorepo layout `server/`, `web/`, `shared/` (shared types and fixed lists).
- **web:** Vue 3, Vite and Pinia. Own service worker for the offline shell and event package. MapLibre GL with OSM vector tiles as **PMTiles**, served from our own server and cached offline.
- **server:** Node 26 (LTS; same version in CI, Docker and `@types/node`) and Fastify 5, in one container. Node runs the `.ts` files directly (type stripping), so there is no server build step: use only erasable syntax (no enums, namespaces or parameter properties) and import with `.ts` extensions. `tsconfig.base.json` enforces this. It holds the API, call logic, escalation timers and report. **SQLite with one file per event**, WAL mode, behind a single data-access layer so Postgres stays possible.
- **Live updates:** Server-Sent Events with a heartbeat every 30 s. Cloudflare drops idle connections after 100 s.
- **Push:** our own Web Push module (VAPID ES256 and aes128gcm) in `server/src/webpush.ts`, tested against the RFC 8291 vector. Reuse it; don't add `web-push`.
- **Service worker:** our own, no Workbox. In dev (`BUILD_ID === 'dev'`) it handles push but not fetches, so Vite always serves fresh code.
- **TypeScript 6**, not 7: vue-tsc still needs the JavaScript-based compiler. Upgrading breaks `npm run typecheck` for `web/` (`ERR_PACKAGE_PATH_NOT_EXPORTED ./lib/tsc`). Dependabot ignores TypeScript, Node and `@types/node` majors; move those deliberately, together.
- **Tests:** `node:test` for units, Playwright end-to-end in CI for the call chain (login → request → call → close).
- **Report:** CSV, plus a print-friendly page saved as PDF.


## Infrastructure

- Image `ghcr.io/groveld/ehbo-app:latest`, built on every push to `main`. Tags `v*` also produce semver tags.
- Unraid with Docker on network `proxynet`, container `ehbo-app`. The app listens on **3000** inside the container; host port 3080 is only for LAN access. Appdata `/mnt/user/appdata/ehbo-app` maps to `/data`, which holds the DB and VAPID keys, so back it up. Unraid auto-updates nightly.
- **From week 52, freeze the image** (pin `:sha-…` or a version, or turn off auto-update), so nothing ships unnoticed on 31 Dec.
- Reachable only via Cloudflare Tunnel: `silvesterloop.groveld.com` → `http://ehbo-app:3000`. All caching is off for the hostname. No Cloudflare Access (it breaks install and push). Rocket Loader is off.
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

- **Login:** `POST /api/session` with a phone number; the session is a random token in an HttpOnly cookie, only its SHA-256 is stored. It lasts until the day after the event's end date (60 days without one). Roles are resolved on every request, so removing someone's number logs them out immediately. Failed attempts are throttled per IP; successful ones aren't (a whole briefing shares one Wi-Fi address).
- **First admin** comes from `ADMIN_PHONE`, only while the event has no admins at all.
- **Admin API** (`/api/admin/*`): every change returns the full `AdminState` and bumps `event.version` (the event package version 2c will use). Phone numbers are normalized server-side; a bad one returns 400 naming the person. Saving a post or unit replaces its contacts or members; a person's name lives in `people` and is shared everywhere. An admin can't remove their own number.
- **Event package** (`GET /api/package`): all fixed data for offline use, versioned as `<event.version>.<map_version>.<s|p>`; the app sends `If-None-Match` and gets 304 when nothing changed. Participants (`p`) get no names, numbers, access routes, units or core team. Logging out deletes the staff package from the phone. `isOpen` in the package is only the starting value; the live state (`/api/live`) has the current one.
- **Offline map:** an admin presses "Kaart ophalen"; the server reads the area around all GPX tracks and posts (+2 km, zoom 0–15, max 6000 tiles) from the latest Protomaps build with range requests, plus fonts and sprites, and stores tiles gzipped in the event DB (`map_tiles`, `map_assets`). They're served at `/map/<map_version>/…` with `immutable`; the app stores every tile in a `ehbo-map-<version>` cache up front, and the service worker answers `/map/` from that cache. The style is `@protomaps/basemaps` (light, Dutch labels). MapLibre's worker must be passed explicitly (`setWorkerUrl` with a `?url` import), or the map stays blank.
- **Data:** `data/app.sqlite` holds server settings (VAPID keys); `data/events/<EVENT>.sqlite` holds everything about one event. Schema changes go in `MIGRATIONS` in `event-db.ts` (append only; `PRAGMA user_version` tracks progress).

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

## Commands

npm workspaces: `shared`, `server`, `web`.

```sh
npm run dev        # Vite on http://localhost:3080, proxies /api to the server on 3000; data in ./data
npm test           # node --test in server/, includes the RFC 8291 vector
npm run typecheck  # tsc for shared and server, vue-tsc + tsc for web
npm run build      # web/dist
npm start          # production mode: server on 3000 serving web/dist
npm run icons      # regenerate icons into web/public/icons (Python + Pillow)
```

Requires Node ≥ 26. For browser testing without installing, open `/?browser=1`. Offline behaviour can only be tested with `build` + `start`.

## Conventions

- GitHub Actions follow the owner's existing workflow style (pinned action versions, GHCR, cleanup keeping 5 untagged). Dependabot updates actions and the Docker base image weekly.
- Keep `README.md` (Dutch, operator-facing: setup, Unraid, Cloudflare, phone test list) up to date when deployment changes.
- When a decision changes, update the **Besluiten** table in `docs/functioneel-ontwerp.md` in the same commit.
- Small, focused commits. Type check and tests must pass, and CI runs a container smoke test before publishing.
- Web app packages are `devDependencies` of `web/` (they're bundled at build time), so the runtime image only installs the server's dependencies.
