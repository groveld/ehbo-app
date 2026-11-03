# CLAUDE.md

Context for Claude (and humans) working in this repo. Read this first, then `docs/functioneel-ontwerp.md`.

## What this is

A PWA for coordinating events: logistics (posts, requests, contacts) and first aid (EHBO), possibly security later. First use: **Silvesterloop Poppenwier, Thursday 31 December 2026** (Kidsrun + 5/10/21 km run/walk, start at Eetcafé De Trilker, ~15 posts, ~20 staff, 2–3 EHBO units).

- Staff install the app on their home screen and log in with their phone number. Participants open it without installing and only see route, posts and start times.
- Everyone on staff sees all posts and contacts and can call or navigate to them.
- A post taps **EHBO**, which alerts the nearest free EHBO unit. After 30 s with no acceptance it goes to all free units; the first to accept gets it. The event coordinator gets a copy of every call.
- Other requests (water, traffic, volunteer) go to the coordinator's queue.
- After the event an admin exports a report (PDF and CSV).

Everything users see is **Dutch**. Everything in the source is **English**: code, identifiers, data values, comments, tests, file names, routes and commit messages, so people from other countries can work on it. The same goes for GitHub issues, PRs and `docs/functioneel-ontwerp.md`; only `README.md` stays Dutch, because it's for the operator. Existing Dutch is being converted in #84; write everything new in English.

## Where things are

| Path | What |
| --- | --- |
| `docs/begrippen.md` | Glossary: one word per concept in the app and one in the code (#84). A proposal until the owner approves it; renaming follows it. |
| `docs/functioneel-ontwerp.md` | Full functional design and **all decisions**. The source of truth; update it when a decision changes. |
| `docs/design/index.html` | Gallery of all 31 screens in process order. `docs/design/screens/*.html` are the per-screen references to build from. |
| `docs/design/source/` | Original design canvas, for re-import into Claude. Don't edit by hand. |
| `server/` | Fastify server (TypeScript, run directly by Node). `src/app.ts` wires it up; `src/routes/` the API; `src/event-db.ts` the per-event data-access layer with migrations; `src/roles.ts` phone number → roles; `src/auth.ts` sessions; `src/db.ts` server settings (VAPID keys); `src/webpush.ts` our own Web Push; `src/demo.ts` fictional test data (`npm run seed`). Tests in `test/`. |
| `web/` | Vue 3 + Vite + Pinia + Vue Router app. One file per screen in `src/views/`, named after the design screen. `src/sw.ts` is the service worker, built as `/sw.js` by the plugin in `vite.config.ts`. Default icons in `public/icons/`; the manifest comes from the server. |
| `shared/` | Types and fixed lists used by both server and web (`@ehbo/shared`). |
| `.github/workflows/build.yml` | Test → build → smoke test → push to GHCR → clean old images. |
| `e2e/`, `playwright.config.ts` | Playwright end-to-end test of the call chain and requests. |

## Status (28 Oct 2026)

- Design finished; no open questions. Live at https://silvesterloop.groveld.com.
- **Done:** phase 1 (install check and Web Push, `v0.2.0`), phase 2 "Basis en beheer" (login and roles, admin screens, event package, offline map, overview, style and logos), phase 3 "EHBO-verzoek en meldingen" (call engine, screens, no-signal fallback, in-app alarm, e2e test), phase 4 "Verzoeken en rapport" (request queue, report with PDF and CSV, test mode, info page in admin).
- **Now:** "Testen op telefoons": a trial day with 5–10 people on real iPhones and Androids, in test mode (README phone test list), then go/no-go. After that "Uitrol en handleiding": manual with screenshots, QR code, everyone installs. From week 52 freeze the image.
- **Report and test mode:** `server/src/report.ts` (report and CSV), routes in `routes/admin.ts`; screens `views/admin/RapportView.vue` (6.1) and `RapportAfdrukView.vue` (print page for PDF). Test mode is `event.test_mode` (migration 7) with `is_test` on incidents and requests; `db.testMode()` prefixes push titles with "Test". The banner is in `App.vue`.

Where the main pieces live:

- **Event package and offline map:** `server/src/routes/package.ts`, `server/src/map.ts`, `routes/map.ts`; on the phone `web/src/stores/package.ts` and `components/EventMap.vue`.
- **Style and logos:** colors and short name in `event.style_json`, logos as PNG in `brand_images` (`server/src/brand.ts`, `routes/brand.ts`), served at `/brand/<name>.png` with a redirect to `/icons/…` when there is no own logo. The browser resizes uploads (`web/src/images.ts`); `web/src/theme.ts` sets `--primary`/`--accent`. The manifest is built by the server.
- **Calls:** `server/src/calls.ts` (dispatch, escalation, AED, accept, on site, close, withdraw, assign, availability, positions) and `routes/calls.ts` (API and SSE at `/api/live`); `notify.ts` pushes to every device of a person. Types in `shared/src/incident.ts`. Tests in `test/calls.test.ts` use a manual scheduler and capture pushes.
- **Requests:** `server/src/requests.ts` and `routes/requests.ts` (table `requests`); part of the live state. Types in `shared/src/request.ts`.
- **Screens for calls and requests:** post home 3.1/3.2 (`PostHomeView`), EHBO request 4.1 (`EhboVerzoekView`), follow-up 4.2/4.6 with manual assign (`MeldingView`), EHBO screen 3.3 (`EhboView`), call 4.3–4.7 (`OproepView`), closing 4.8 (`AfrondenView`), no signal 4.9 (`GeenBereikView`), request 5.1 (`AanvraagView`), queue 5.2 in the Meldingen tab (`MeldingenTab`). Navigation is one tab bar on every staff page (`components/TabBar.vue`, mounted in `App.vue`); the rest lives in `MenuView`. `components/StatusBlock.vue` is the 140 px header.
- **Locations and functions** (#83): a post (in the app a locatie) has one or more functions in `post_functions`; `posts.type_id` is the main function, the highest in `MARKER_ORDER` (`shared/src/event.ts`, `mainFunction`), kept by the server on save. The package has `typeId` (main) and `functionIds` (main first). At most one `verantwoordelijke` per location (400 naming it). A function can be unmanned (`post_types.manned`: AED, toilets, turnaround); a location with only those has no people, times or open/closed (`isManned`). A turnaround has `posts.run_id`. `isEhbo` in `calls.ts` means any EHBO function. On the map the other functions and a standplaats are petals around the marker from `FLOWER_ZOOM` (15), a count further out (`petalsOf` in `EventMap.vue`).
- **Km points:** `passages` and `recomputePassages` in `server/src/gpx.ts`, table `post_passages`. They're recalculated after every change to a GPX, a run or a post. `posts.km` is derived (first pass on the longest run), never entered; `kmLabel(post)` in `web/src/posts.ts` shows it.
- **Map tab:** `KaartView` stays mounted in `App.vue` for staff, out of sight (`map-waiting`), built just after the first screen, so the tab is instant. Out of view it does nothing: no live updates, no GPS, no list (`active`, `mapView`, `paused`). Opening the tab brings it up to date in one go. The route `kaart` itself renders nothing.
- **Route page:** `views/RouteView.vue` at `/route/:id`, public. A tap on a run on the participant page opens it. `GET /gpx/<id>.gpx` serves a clean GPX (`cleanGpx` in `gpx.ts`), kept in the `ehbo-gpx` cache for offline use. `routeStops` in `web/src/posts.ts` gives the posts in order.
- **Live state on the phone:** `web/src/stores/live.ts`: `units` is the server's teams with this phone's own mobile team at its live GPS fix (`ownFix`, never sent more than once a minute), used for its own ambulance and call line; SSE with a watchdog (the heartbeat is a real `ping` event), the queue of changes, the outbox for EHBO requests without signal (resent with the same `clientId`), GPS sharing for mobile units. `web/src/alarm.ts` is the repeating sound and vibration.
- **Screen on:** `web/src/wakeLock.ts` (Screen Wake Lock, on by default for staff, `ehbo.awake`), held from `App.vue`, switch in `MenuView`.
- **Additions en route:** `update()` in `calls.ts` only logs and pushes a real change, saying what changed; the push has `quietInApp`, so the service worker shows it silently with the app in view. `App.vue` plays `chime()` (`alarm.ts`) once when `lastAddition` of `live.myActive` changes; 4.7 marks it new until seen (`ehbo.seen-additions`).
- **End-to-end:** `e2e/` with Playwright; `e2e/server.ts` starts a seeded server on 3090. One worker; tests clean up after themselves.

## Chosen stack (decided 28 Oct 2026)

- **TypeScript** everywhere. Monorepo layout `server/`, `web/`, `shared/` (shared types and fixed lists).
- **web:** Vue 3, Vite and Pinia. Own service worker for the offline shell and event package. MapLibre GL with OSM vector tiles as **PMTiles**, served from our own server and cached offline.
- **server:** Node 26 (LTS; same version in CI, Docker and `@types/node`) and Fastify 5, in one container. Node runs the `.ts` files directly (type stripping), so there is no server build step: use only erasable syntax (no enums, namespaces or parameter properties) and import with `.ts` extensions. `tsconfig.base.json` enforces this. It holds the API, call logic, escalation timers and report. **SQLite with one file per event**, WAL mode, behind a single data-access layer so Postgres stays possible.
- **Live updates:** Server-Sent Events with a heartbeat every 30 s. Cloudflare drops idle connections after 100 s.
- **Push:** our own Web Push module (VAPID ES256 and aes128gcm) in `server/src/webpush.ts`, tested against the RFC 8291 vector. Reuse it; don't add `web-push`.
- **Service worker:** our own, no Workbox. Pages always come from the cache of the installed version and never wait for the network; a new version arrives as a new service worker. In dev (`BUILD_ID === 'dev'`) it handles push but not fetches, so Vite always serves fresh code.
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
- **Signal colors** are fixed and never themed: red `#C8261E` for urgent, green `#0A7D4F` for OK. Each post type has its own color and icon (`web/src/icons.ts`: flag, drop, stamp, cone, ehbo, aed, toilet, uturn, more); a custom type without an icon shows its letter.
- **Colored header blocks** (call, sent, en route, EHBO screen, no signal): always 84 px tall, text vertically centered, title 26 px, no subtext.
- **EHBO status colors** are fixed, never the event's primary color: dark (`--off`) is not here, red is here but not available (also during a call), green is here and available.
- **Status bar** (`components/LiveBar.vue`, `composables/useLiveBar.ts`): 58 px on top of the tab bar, just below its height, on every staff page, for the post that asked for help and the EHBO team on a call, in the status header's colors. Not on the call itself. `--tabbar` grows with it, so everything at the bottom moves up. Several open calls show the newest with +1 and open the post. The coordinator has the Meldingen tab instead; requests stay out of it.
- **Dialogs:** never the browser's `confirm()`; use `confirmDialog`/`messageDialog` (`composables/useDialog.ts`, shown by `components/AppDialog.vue`).
- **Offline pill** (`components/OfflinePill.vue`): on every screen, centered between the bottom button and the tab bar (bottom left without one), only the word Offline: no count and nothing to tap. Online shows nothing.
- **No page titles on tab screens** (map, requests, contacts, menu): the tab bar already says where you are. Screens reached from a tab (post detail, admin) keep their header.
- **Buttons:**
  - Primary: 56 px tall, 16 px bold.
  - Secondary: 48 px, white with a 1.5 px line in the primary color.
  - One corner radius (16 px) for all buttons; screens only change size or fill, never the shape.
  - Icon button: 44 × 44.
  - Two buttons side by side are always the same height.
- **112** is only shown where it matters: the EHBO screens (request, follow-up, EHBO screen, call, no signal), Overzicht › Contacten. Where it is shown it sits at the bottom, in the same place. The participant screen has "Bel EHBO" instead: a floating red button with a cross and that text, anchored bottom right and growing to the left (says "Bel 112" and calls 112 when no number is set). The app never replaces 112.
- **Start screen:** without a session the app opens with a short intro (`components/IntroSplash.vue`: fixed pink and yellow shapes, apart from the event theme; all runs drawn alike as one course; logo, event name, date and place centered; 4 s, any touch or key ends it), then the participant page (`/`), with "Aanmelden" at the top right. There is no staff/participant choice screen. The tab bar is hidden during login (Herkend, Toestemmingen) until "Klaar, naar mijn startscherm".
- **Save only when needed:** a form shows its save button only after a change (`composables/useDirty.ts`: snapshot on load and after saving). A new item (post, unit, run) can always be saved. A new EHBO request can always be sent; adding details only after a change.
- The request tiles on the post home screen are deliberately large; this is the one exception to the button sizes.
- **"Post sluiten"** is a small, subtle red button at the top right, so it can't be confused with closing the screen.
- **Mobile-first, but dynamic:** design for a 390 × 844 phone and check every new screen against `docs/design/screens/`, but nothing may depend on that exact size. Content is one column of at most 720 px (also the tab bar), text in buttons may wrap, and maps use `clamp(…, dvh, …)` heights. Check 320 px wide and a tablet. No desktop layout (yet).

## Key behaviour (details in the design doc)

- **Login:** `POST /api/session` with a phone number; the session is a random token in an HttpOnly cookie, only its SHA-256 is stored. It lasts until the day after the event's end date (60 days without one). Roles are resolved on every request, so removing someone's number logs them out immediately. Failed attempts are throttled per IP; successful ones aren't (a whole briefing shares one Wi-Fi address).
- **First admin** comes from `ADMIN_PHONE`, only while the event has no admins at all.
- **Admin API** (`/api/admin/*`): every change returns the full `AdminState` and bumps `event.version` (the event package version 2c will use). Phone numbers are normalized server-side; a bad one returns 400 naming the person. Saving a post or unit replaces its contacts or members; a person's name lives in `people` and is shared everywhere. An admin can't remove their own number.
- **Event package** (`GET /api/package`): all fixed data for offline use, versioned as `<event.version>.<map_version>.<s|p><format>` (bump `PACKAGE_FORMAT` in `routes/package.ts` when the package's shape changes); the app sends `If-None-Match` and gets 304 when nothing changed. Participants (`p`) get no names, numbers, access routes or core team, and units only with their kind and post (no name or members), for the cross on the map; plus `ehboPhone` (EHBO coordinator, else event coordinator) for their "Bel EHBO" button. Logging out deletes the staff package from the phone. `isOpen` in the package is only the starting value; the live state (`/api/live`) has the current one. The live state's `dataVersion` (the start of the package version) tells a phone there's a new package; participants read it from `/api/ehbo-status`. `syncData` in `stores/live.ts` then fetches the package, session and style; a reference to an unknown post or unit does so at once. Incidents and requests carry enough of their post (`incident.post`, `postName`; `postOf` in `web/src/incidents.ts`) to work without the new package.
- **Offline map:** an admin presses "Kaart ophalen"; the server reads the area around all GPX tracks and posts (+2 km, zoom 0–15, max 6000 tiles) from the latest Protomaps build with range requests, plus fonts and sprites, and stores tiles gzipped in the event DB (`map_tiles`, `map_assets`). They're served at `/map/<map_version>/…` with `immutable`; the app stores every tile in a `ehbo-map-<version>` cache up front, and the service worker answers `/map/` from that cache. The style is `@protomaps/basemaps` with our own calm flavor (`MAP_FLAVOR` in `EventMap.vue`: the light flavor muted to grey with pastel water and green, no POI icons, Dutch labels). The selected run is drawn on top (`line-sort-key`). All markers (posts, ambulance) are 28 px. MapLibre's worker must be passed explicitly (`setWorkerUrl` with a `?url` import), or the map stays blank.
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
  - Mobile unit: the freshest GPS fix of its members (shared every minute while on duty, `PUT /api/position`, kept per person in `calls.ts`), otherwise its standplaats post.
  - A help request from a GPS position (`postId: null`, `/hulp`): counted from that position (`targetOf` in `calls.ts`).
- **AED rule:** when the person is not responsive, the call goes to the nearest free unit and the nearest free AED unit at once.
- **Statuses:** reported → sent → accepted → on site (one tap) → closed, or withdrawn. Every step is timestamped.
- **No signal:** maps, contacts, calling and navigating all work offline. The help button goes straight to calling the nearest EHBO unit and the coordinator (with bad signal after 4 s), while the request keeps being sent.
- **Changes never wait for the network:** every action in `stores/live.ts` is applied to the phone's own state at once (`applyAction` in `shared/src/action.ts`, the same result as the server; change both together) and queued in order in `ehbo.queue`, surviving a restart. `state` is the server's state with the queue on top. The server runs each `X-Action-Id` once (`calls.once`, table `client_actions`) and logs `X-Action-At`, the time on the phone. A refusal shows a dialog. A request made offline has a negative id until the real one arrives (`requestIds`).
- **Back and forward** (`web/src/navigation.ts`): swiping is off. Every navigation replaces the current history entry, so the phone never has a previous or next page to swipe to or preview (a cancelled or redirected gesture always flashes the wrong page). On Android the device back button therefore closes the app. The in-app back arrow (`router.back()`) goes one step up via `upOf`: post detail → map, admin page → its parent, a tab → the start screen.
- **At a post:** one radius, `event.at_post_m` (default 30 m, like a post's distance to the GPX route; set in Beheer › Evenement, in the package as `event.atPostM`; `atPostM(pkg)` in `web/src/posts.ts`), decides when a position counts as a post: a mobile unit at its standplaats, a self-started incident, a help request from GPS (`placeOf`).
- **Home or away:** a mobile unit within `atPostM` of its standplaats is home (`isAway`/`awayPostIds` in `shared/src/incident.ts`). Away, staff see the ambulance; everyone, participants too, sees the cross at the standplaats grey. Participants poll the public `GET /api/ehbo-status`, which returns only those post ids, never positions.
- **Closing by time** (`sweep` in `calls.ts`, every minute; `plannedClose` in `shared/src/incident.ts`): an open post or a team on duty closes 30 min after its planned end, always 10 min after a warning (`closes_at`) and never during an open call or request. "Open houden" gives 30 min more (`keep_until`). No end time: only when the event is over. Never on "no connection": a phone in a pocket has none either; `/api/live/last-seen` only shows the coordinator who has been quiet for 15 min. A request from a post closed by time reopens it, so a phone without signal is never refused. Nothing closes by itself before the event's start date.
- **Logged in means being there** (`leave`/`arrive` in `calls.ts`, `sessionsEnded` in `auth.ts`): a post or team with nobody logged in is closed, at the last logout, an expired session (checked in the sweep) or "Iedereen afmelden" (`/api/admin/logout-all`), and the first login finds it closed. A team busy with a call goes off duty once the call ends. Logout sends the phone's push endpoint and, without signal, is retried (`ehbo.logout`). A number with no session left loses its push subscriptions. Test-mode sessions end at midnight (`nextMidnight`).
- **Openen en sluiten** (`views/SturingView.vue`, `/api/control/*`, coordinator and admins): open all (only what someone is logged in for), close all, close the day. The day can't close during an open call.
- **Waiting calls:** `offerOpenCalls` in `calls.ts`: a team that becomes available gets a call nobody available can react to at once; otherwise the call waits for the round to all teams.
- **Scroll:** every page keeps its own position (`scrolled` in `router.ts`).
- **Self-started incident** (`selfStart` in `calls.ts`, `views/EigenIncidentView.vue`): an EHBO team on duty starts it itself; it's on site at once and goes straight to closing, with no call to others (only an AED unit when the person isn't responsive). The place: a fixed team's own post; a mobile team's GPS, which is the post itself within the home radius (`placeOf`), otherwise a distance from the nearest post (`offPost`; `post_id` is then only for the report), or else its standplaats. Works offline through the queue.
- **Privacy:** no casualty names or medical details are stored. Positions are not stored: the last GPS fix of a member of a mobile unit on duty lives only in server memory and is shown live to staff on the map (as an ambulance) while it is fresh (3 min); nobody else shares one. Your own position on the map (Mijn locatie, `EventMap.vue`) never leaves the phone. The exceptions are the place of an incident away from a post: self-started, or a help request from a GPS position (with its accuracy).

## Commands

npm workspaces: `shared`, `server`, `web`.

```sh
npm run dev        # Vite on http://localhost:3080, proxies /api to the server on 3000; data in ./data
npm test           # node --test in server/, includes the RFC 8291 vector
npm run typecheck  # tsc for shared and server, vue-tsc + tsc for web
npm run build      # web/dist
npm start          # production mode: server on 3000 serving web/dist
npm run e2e        # Playwright end-to-end test of the call chain (needs `npm run build` and `npx playwright install chromium`)
```

Requires Node ≥ 26. For browser testing without installing, open `/?browser=1`. Offline behaviour can only be tested with `build` + `start`.

## Conventions

- **Still in development: no backwards compatibility.** When a route, screen or name changes, change it everywhere and remove the old one. No redirects from old URLs, aliases or shims.

- GitHub Actions follow the owner's existing workflow style (pinned action versions, GHCR, cleanup keeping 5 untagged). Dependabot updates actions and the Docker base image weekly.
- Keep `README.md` (Dutch, operator-facing: setup, Unraid, Cloudflare, phone test list) up to date when deployment changes.
- When a decision changes, update the **Besluiten** table in `docs/functioneel-ontwerp.md` in the same commit.
- Small, focused commits. Type check and tests must pass, and CI runs a container smoke test before publishing.
- **Every issue ends in a PR, without being asked:** work on a branch from the latest `origin/main`, then commit, push and open a PR that closes the issue. Issues merged into one piece of work share one PR. The owner reviews and merges; never merge a PR yourself.
- Web app packages are `devDependencies` of `web/` (they're bundled at build time), so the runtime image only installs the server's dependencies.
