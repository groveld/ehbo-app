# EHBO Evenementen-app — testversie

Eerste, kleine versie van de app. Hij doet nog niets inhoudelijks, maar controleert de drie dingen waar de rest op bouwt:

1. **Installeren** als app op het beginscherm (iPhone en Android).
2. **Pushmeldingen**: aanzetten, testmelding nu en na 10 seconden (vergrendelscherm).
3. **Uitrol**: GitHub bouwt bij elke push een Docker-image, Unraid draait het, Cloudflare Tunnel maakt het bereikbaar.

Gebouwd op de gekozen stack: TypeScript, een Fastify-server en een Vue 3-app (Vite, Pinia) in één container. De database is SQLite via de ingebouwde `node:sqlite`. De push-versleuteling (VAPID en aes128gcm) is eigen code, getest tegen de officiële testvector uit RFC 8291.

**Ontwerp en besluiten:** zie [`docs/`](docs/README.md): functioneel ontwerp, alle schermen en het gekozen stack. Context voor Claude Code staat in [`CLAUDE.md`](CLAUDE.md).

## Overzicht

```
telefoon (PWA) ──https──► Cloudflare ──tunnel──► cloudflared ──http──► ehbo-app:3000 (Unraid)
                                                                         │
telefoon ◄──── melding ──── push-dienst Apple / Google ◄──── uitgaand ───┘
```

## 1. GitHub

1. Maak een repository aan en zet deze bestanden erin (branch `main`).
2. De workflow `.github/workflows/build.yml` draait bij elke push en pull request:
   - typecontrole, `npm test` en de webapp bouwen;
   - Docker-image bouwen;
   - rooktest: container starten en `/healthz`, `/api/info`, het manifest en de service worker opvragen;
   - op `main` publiceren als `ghcr.io/<owner>/<repo>:latest` en `:sha-<commit>`; een tag `v1.2.3` geeft ook `:1.2.3`;
   - oude, ongetagde images opruimen (laatste 5 blijven bewaard).
   Pull requests worden alleen getest en gebouwd, niet gepubliceerd. Dependabot houdt de actions, de npm-pakketten en het Node-basisimage bij.
3. Het image is standaard **privé**. Kies één van twee:
   - maak het package openbaar (GitHub › Packages › ehbo-app › Package settings › Change visibility). Er staan geen geheimen in het image; of
   - log op Unraid in: `docker login ghcr.io -u <github-gebruiker>` met een *personal access token* met alleen `read:packages`.

## 2. Unraid

**Via template (aanbevolen):**

1. Vervang `OWNER/REPO` in `unraid/my-ehbo-app.xml` door je repository (kleine letters).
2. Kopieer het bestand naar `/boot/config/plugins/dockerMan/templates-user/`.
3. Docker › Add Container › Template **ehbo-app**.
4. Vul **VAPID_SUBJECT** in met een echt adres, bijvoorbeeld `mailto:beheer@jouwdomein.nl`. Zonder geldig adres weigert Apple meldingen.
5. Apply. De container draait als `99:100` (nobody:users) en bewaart alles in `/mnt/user/appdata/ehbo-app`.

De app luistert in de container op poort **3000**. Zet de container in hetzelfde Docker-netwerk als cloudflared (bij ons `proxynet`); dan heeft de tunnel geen gepubliceerde poort nodig. De poort `3080` op de Unraid-server is alleen handig om vanaf je thuisnetwerk te testen.

**Of met Docker Compose:** zie `docker-compose.yml`.

**Bijwerken:** Unraid controleert elke nacht op een nieuw `:latest`-image en werkt automatisch bij. Elke push naar `main` staat dus de volgende ochtend live; in de app zie je bovenaan welke versie draait.

> **Rond het evenement:** zet vanaf week 52 de automatische update voor deze container uit, of zet het image vast op een geteste versie (bijv. `ghcr.io/groveld/ehbo-app:sha-abc1234` of `:1.0.0`). Zo kan een late wijziging nooit ongemerkt op 31 december live gaan.

> **Back-up:** `app.sqlite` in appdata bevat de VAPID-sleutels. Gaan die verloren, dan moet iedereen meldingen opnieuw aanzetten. Neem deze map mee in je back-up.

## 3. Cloudflare Tunnel

In Zero Trust › Networks › Tunnels › jouw tunnel › **Public hostname**:

| Veld | Waarde |
| --- | --- |
| Subdomain / domain | `silvesterloop` . `groveld.com` |
| Service | `HTTP` · `ehbo-app:3000` (cloudflared in hetzelfde Docker-netwerk), of `<unraid-ip>:3080` |

Belangrijk voor installeren en meldingen:

- **Geen Cloudflare Access** op deze hostname. Een inlogscherm breekt de geïnstalleerde app en de aanmelding voor meldingen.
- **Cache:** maak een *Cache Rule* voor deze hostname: **Bypass cache** voor `/sw.js`, `/manifest.webmanifest` en `/api/*`. De app stuurt zelf al `no-cache`, dit is een extra zekerheid.
- **Rocket Loader uit** voor deze hostname (Speed › Optimization). Rocket Loader herschrijft scripts en breekt de service worker.
- *Always Use HTTPS* aan.
- De server moet **uitgaand** internet hebben naar de push-diensten (`web.push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com`). Dit loopt niet via de tunnel.

## 4. Testen op een telefoon

Open het adres op de telefoon. Doe dit met minstens één iPhone en één Android-toestel.

| # | Stap | Verwacht |
| --- | --- | --- |
| 1 | Adres openen in Safari (iPhone) of Chrome (Android) | Scherm "Zet de app eerst op je beginscherm", met het juiste toestel herkend |
| 2 | iPhone: Deel › Zet op beginscherm. Android: knop **Installeren** | Icoon (antraciet met gele route) op het beginscherm |
| 3 | App openen vanaf het beginscherm | Controle: Geïnstalleerd **ja**, Service worker **actief**, Server **bereikbaar** + versie |
| 4 | **Meldingen aanzetten** | Toestemmingsvraag; daarna Meldingen **toegestaan**, Aangemeld **ja** |
| 5 | **Testmelding nu** | Melding verschijnt, ook als de app open is |
| 6 | **Over 10 s** en meteen vergrendelen | Melding op het vergrendelscherm, met geluid of trilling |
| 7 | App volledig afsluiten (wegvegen), stap 6 via een tweede toestel of opnieuw | Melding komt nog steeds binnen |
| 8 | Vliegtuigmodus aan, app openen | App opent (offline), Server **niet bereikbaar** |
| 9 | Tik op een melding | App opent |

Lukt stap 4 niet op een iPhone: controleer iOS 16.4 of nieuwer en dat de app vanaf het beginscherm is geopend, niet in Safari.

**Testen zonder installatie (alleen voor beheer, op een computer):** open `/?browser=1`.

## Lokaal ontwikkelen

Vereist Node 22.18 of nieuwer: de server draait zijn TypeScript direct met Node, zonder compileerstap.

```sh
npm install        # eenmalig
npm run dev        # open http://localhost:3080 (Vite); de API draait op 3000, data in ./data
npm test           # servertests
npm run typecheck  # TypeScript-controle van alle onderdelen
npm run build      # webapp bouwen naar web/dist
npm start          # server op http://localhost:3000, met de gebouwde webapp
npm run icons      # iconen opnieuw maken (vereist Python + Pillow)
```

| Map | Wat |
| --- | --- |
| `server/` | Fastify: API, pushmeldingen, levert de gebouwde webapp |
| `web/` | Vue-app en de service worker (`web/src/sw.ts`, gebouwd als `/sw.js`) |
| `shared/` | Typen die server en web allebei gebruiken |

Bij `npm run dev` slaat de service worker niets op voor offline gebruik, zodat je altijd de nieuwste code ziet. Offline testen doe je met `npm run build` en `npm start`.

Omgevingsvariabelen: `PORT` (3000), `HOST` (0.0.0.0), `DATA_DIR` (/data), `VAPID_SUBJECT`, `LOG_LEVEL` (info), optioneel `VAPID_PUBLIC_KEY` en `VAPID_PRIVATE_KEY` (anders automatisch aangemaakt en bewaard).

## API (testversie)

| Methode | Pad | Doel |
| --- | --- | --- |
| GET | `/healthz` | Gezondheidscheck |
| GET | `/api/info` | Versie, commit, publieke VAPID-sleutel |
| POST | `/api/subscriptions` | Abonnement opslaan `{ subscription }` |
| DELETE | `/api/subscriptions` | Abonnement verwijderen `{ endpoint }` |
| POST | `/api/test-push` | Testmelding naar je eigen toestel `{ endpoint, delaySeconds }` |

Er is nog geen aanmelding met telefoonnummer. Iedereen met het adres kan zich aanmelden voor meldingen, maar kan alleen zichzelf een testmelding sturen.
