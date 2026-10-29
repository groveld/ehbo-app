# EHBO Evenementen-app

App voor de EHBO-coördinatie bij evenementen. Wat er werkt:

1. **Installeren** als app op het beginscherm (iPhone en Android).
2. **Aanmelden** met je telefoonnummer: de app zoekt zelf je functie en post op. Daarna meldingen en locatie aanzetten met een testmelding; info & voorwaarden staan in het menu.
3. **Beheer** (alleen beheerders): evenement en lopen met GPX, info & voorwaarden, stijl (groot logo, vierkant logo als app-icoon, kleuren, korte naam), posten met GPS-positie en contactpersonen, EHBO-eenheden, kernteam, noodnummers en beheerders. Wie je als contact of lid invoert, kan met dat nummer inloggen.
4. **Overzicht** voor medewerkers: kaart met alle posten, filter per soort, lijsten met bel- en navigeerknop, alle contacten, en per post de aanrijroute en de dichtstbijzijnde EHBO. Open oproepen staan rood bovenaan.
5. **EHBO-oproepen**: de post zet zijn post open en vraagt EHBO aan; de dichtstbijzijnde vrije eenheid krijgt een alarm, na 30 s alle vrije eenheden. Accepteren, ter plaatse, afronden; de evenementcoördinator kijkt mee en kan zelf een eenheid inzetten.
6. **Aanvragen** voor water, verkeer en vrijwilligers: in de wachtrij van de evenementcoördinator, die ze oppakt en afhandelt.
7. **Deelnemers**: route, starttijden (favoriete loop vooraan) en de posten langs de route, zonder namen of nummers.
8. **Zonder bereik**: alle vaste gegevens en de kaart staan op de telefoon. Een EHBO-verzoek zonder bereik toont wie je kunt bellen en gaat vanzelf weg zodra er weer bereik is.

9. **Rapport** voor de beheerder: kerncijfers en alle incidenten, als PDF en CSV. Een testmodus houdt proefoproepen buiten het rapport.


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
   - end-to-end-test van de oproepketen in Chromium (`npm run e2e`, Playwright);
   - Docker-image bouwen;
   - rooktest: container starten en `/healthz`, `/api/info`, het manifest en de service worker opvragen;
   - op `main` publiceren als `ghcr.io/<owner>/<repo>:latest` en `:sha-<commit>`; een tag `v1.2.3` geeft ook `:1.2.3`;
   - oude, ongetagde images opruimen (laatste 5 blijven bewaard).
   Pull requests worden alleen getest en gebouwd, niet gepubliceerd. Dependabot houdt de actions, de npm-pakketten en het Node-basisimage bij.
3. Het image is standaard **privé**. Kies één van twee:
   - maak het package openbaar (GitHub › Packages › ehbo-app › Package settings › Change visibility). Er staan geen geheimen in het image; of
   - log op Unraid in: `docker login ghcr.io -u <github-gebruiker>` met een *personal access token* met alleen `read:packages`.

## 2. Unraid

Docker › **Add Container**, met deze instellingen:

| Instelling | Waarde |
| --- | --- |
| Name | `ehbo-app` |
| Repository | `ghcr.io/groveld/ehbo-app:latest` (rond het evenement een vaste versie, zie hieronder) |
| Network | hetzelfde netwerk als cloudflared (bij ons `proxynet`) |
| Extra parameters | `--user 99:100 --restart unless-stopped` (nobody:users, zodat appdata schrijfbaar is) |
| Poort | container `3000` → host `3080` (alleen voor testen vanaf het thuisnetwerk) |
| Pad | container `/data` → `/mnt/user/appdata/ehbo-app` (database en VAPID-sleutels; back-up maken) |
| WebUI | `http://[IP]:[PORT:3000]/?browser=1` |

| Variabele | Verplicht | Waarde |
| --- | --- | --- |
| `VAPID_SUBJECT` | ja | Contactadres voor de push-diensten, bijv. `mailto:beheer@jouwdomein.nl`. Zonder geldig adres weigert Apple meldingen |
| `ADMIN_PHONE` | ja | Telefoonnummer van de eerste beheerder, bijv. `+31612345678` (`0612345678` mag ook). Alleen gebruikt zolang het evenement nog geen beheerder heeft; daarna beheer je beheerders in de app |
| `TZ` | nee | `Europe/Amsterdam` |
| `EVENT` | nee | Naam van het evenementbestand in `appdata/events/` (standaard `silvesterloop`) |

De app luistert in de container op poort **3000**. In hetzelfde Docker-netwerk als cloudflared heeft de tunnel geen gepubliceerde poort nodig.

**Of met Docker Compose:**

```yaml
services:
  ehbo-app:
    image: ghcr.io/groveld/ehbo-app:latest
    container_name: ehbo-app
    restart: unless-stopped
    user: "99:100"
    ports:
      - "3080:3000"
    environment:
      TZ: Europe/Amsterdam
      VAPID_SUBJECT: "mailto:beheer@jouwdomein.nl"
      ADMIN_PHONE: "+31612345678"
    volumes:
      - /mnt/user/appdata/ehbo-app:/data
```

**Gegevens:** `app.sqlite` bevat de VAPID-sleutels van de server, `events/<evenement>.sqlite` alles van één evenement (posten, mensen, aanmeldingen). Archiveren of verwijderen na afloop = dat ene bestand.

**Bijwerken:** Unraid controleert elke nacht op een nieuw `:latest`-image en werkt automatisch bij. Elke push naar `main` staat dus de volgende ochtend live; onder **Controle van installatie** in de app zie je welke versie draait.

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
- **Cache:** maak een *Cache Rule* voor deze hostname: **Bypass cache** voor `/sw.js`, `/manifest.webmanifest`, `/brand/*` (logo's en app-icoon van het evenement) en `/api/*`. De app stuurt zelf al `no-cache`, dit is een extra zekerheid.
- **Rocket Loader uit** voor deze hostname (Speed › Optimization). Rocket Loader herschrijft scripts en breekt de service worker.
- *Always Use HTTPS* aan.
- De server moet **uitgaand** internet hebben naar de push-diensten (`web.push.apple.com`, `fcm.googleapis.com`, `updates.push.services.mozilla.com`), en voor het ophalen van de kaart naar `build-metadata.protomaps.dev`, `build.protomaps.com` en `protomaps.github.io`. Dit loopt niet via de tunnel.
- `/map/*` (kaarttegels) mag bij Cloudflare in de cache: de versie zit in het adres en de server stuurt `immutable`. Laat de bestaande regel voor `/sw.js`, het manifest en `/api/*` staan.

## 4. Testen op een telefoon

Volg [docs/testprocedure.md](docs/testprocedure.md): wat je nodig hebt (toestellen, mensen, nummers), de voorbereiding in beheer, en per blok welke stap op welk toestel, met wat je moet zien. Doe het met minstens twee iPhones en twee Android-toestellen, in de testmodus.

**Testen zonder installatie (alleen voor beheer, op een computer):** open `/?browser=1`; dat blijft gelden tot je het tabblad sluit.

## Lokaal ontwikkelen

Vereist Node 26 of nieuwer: de server draait zijn TypeScript direct met Node, zonder compileerstap.

```sh
npm install        # eenmalig
npm run seed       # verzonnen testgegevens in ./data (posten, EHBO-eenheid, kernteam); toont de nummers om mee aan te melden
npm run dev        # open http://localhost:3080/?browser=1 (Vite); de API draait op 3000
npm test           # servertests
npm run typecheck  # TypeScript-controle van alle onderdelen
npm run build      # webapp bouwen naar web/dist
npm run e2e        # end-to-end-test (na npm run build; eenmalig npx playwright install chromium)
npm start          # server op http://localhost:3000, met de gebouwde webapp
```

| Map | Wat |
| --- | --- |
| `server/` | Fastify: API, pushmeldingen, levert de gebouwde webapp |
| `web/` | Vue-app en de service worker (`web/src/sw.ts`, gebouwd als `/sw.js`) |
| `shared/` | Typen die server en web allebei gebruiken |

Bij `npm run dev` slaat de service worker niets op voor offline gebruik, zodat je altijd de nieuwste code ziet. Offline testen doe je met `npm run build` en `npm start`.

Omgevingsvariabelen: `PORT` (3000), `HOST` (0.0.0.0), `DATA_DIR` (/data), `ADMIN_PHONE`, `EVENT` (silvesterloop), `VAPID_SUBJECT`, `LOG_LEVEL` (info), optioneel `VAPID_PUBLIC_KEY` en `VAPID_PRIVATE_KEY` (anders automatisch aangemaakt en bewaard).

## API

| Methode | Pad | Wie | Doel |
| --- | --- | --- | --- |
| GET | `/healthz` | iedereen | Gezondheidscheck |
| GET | `/api/info` | iedereen | Versie, commit, publieke VAPID-sleutel |
| GET | `/api/event` | iedereen | Naam, datum, info-tekst, kleuren en logo's van het evenement (zonder namen of nummers) |
| GET | `/manifest.webmanifest` | iedereen | Manifest met de naam, korte naam, kleur en iconen van het evenement |
| GET | `/brand/<naam>.png` | iedereen | Groot logo en app-iconen; zonder eigen logo een verwijzing naar het standaardicoon |
| PUT/DELETE | `/api/admin/brand/logo`, `/api/admin/brand/icon` | beheerder | Groot logo of vierkant logo (alle icoonmaten, door de app gemaakt) opslaan of verwijderen |
| GET | `/api/package` | iedereen | Evenementpakket voor offline gebruik; medewerkers krijgen ook contacten, eenheden en kernteam. `If-None-Match` geeft 304 |
| GET | `/map/<versie>/…` | iedereen | Kaarttegels, lettertypen en iconen |
| GET/POST | `/api/admin/map` | beheerder | Kaart ophalen (op de achtergrond) en de voortgang |
| POST | `/api/session` | iedereen | Aanmelden `{ phone }`; zet de sessiecookie. 404 als het nummer onbekend is |
| DELETE | `/api/session` | iedereen | Afmelden |
| GET | `/api/me` | medewerker | Naam, rollen en startscherm |
| POST | `/api/subscriptions` | medewerker | Abonnement opslaan `{ subscription }` |
| DELETE | `/api/subscriptions` | medewerker | Abonnement verwijderen `{ endpoint }` |
| POST | `/api/test-push` | medewerker | Testmelding naar je eigen toestel `{ endpoint, delaySeconds }` |
| GET | `/api/live` | medewerker | Live stand (SSE): oproepen, eenheden en open/dicht van posten; bij elke wijziging een nieuw bericht, hartslag elke 30 s |
| GET | `/api/live/state` | medewerker | Dezelfde stand in één antwoord |
| POST | `/api/incidents` | post | EHBO-verzoek `{ postId, clientId, what, persons, responsive, note }`; dezelfde `clientId` telt één keer |
| PUT | `/api/incidents/:id` | post | Melding aanvullen |
| POST | `/api/incidents/:id/accept`, `/decline` | EHBO-eenheid | Accepteren of "kan niet" `{ unitId }` |
| POST | `/api/incidents/:id/on-site`, `/close` | EHBO-eenheid | Ter plaatse; afronden `{ outcome, persons, note, stayHere }` |
| POST | `/api/incidents/:id/withdraw` | post | Melding intrekken |
| POST | `/api/incidents/:id/assign` | coördinator | Oproep toewijzen aan een eenheid `{ unitId }` |
| PUT | `/api/units/:id/availability` | EHBO-eenheid | Vrij, even pauze of uit dienst |
| PUT | `/api/units/:id/position` | EHBO-eenheid | Positie van een mobiele eenheid (alleen in het geheugen van de server) |
| PUT | `/api/posts/:id/open` | postverantwoordelijke | Post open of dicht `{ open }` |
| POST | `/api/requests` | post | Aanvraag water, verkeer of vrijwilliger `{ postId, kind, detail, clientId }` |
| PUT | `/api/requests/:id` | post | Aanvullen `{ detail }` |
| POST | `/api/requests/:id/pick`, `/done`, `/withdraw` | coördinator, post | Oppakken, afhandelen (coördinator, kernteam, beheerder) of intrekken (post) |
| GET | `/api/admin/report`, `/api/admin/report.csv` | beheerder | Rapport als JSON (scherm en afdrukpagina) of als CSV-download |
| PUT | `/api/admin/test-mode` | beheerder | Testmodus aan of uit `{ on }` |
| DELETE | `/api/admin/test-data` | beheerder | Proefoproepen en -aanvragen wissen |
| PUT | `/api/admin/info` | beheerder | Info & voorwaarden `{ sections, policy, contact }`; `sections: null` = standaardtekst |

Het nummer is in deze versie een identificatie, geen beveiliging (zie het functioneel ontwerp). Mislukte aanmeldpogingen worden per IP-adres afgeremd en elke aanmelding komt in het logboek.
