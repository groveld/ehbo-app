# Glossary: one name per concept

**Status: proposal (3 Nov), for the owner to approve before anything is renamed** (#84 step 1, together with #86).

Each concept has one word in the app (Dutch, for users) and one in the code (English). The code word is used everywhere in the source: tables and columns, types, API routes, file names, route names, `localStorage` keys, tests and comments. Dutch stays only in text users see.

The decisions of 30 Oct still hold: "melding" and "locatie" may each keep two meanings in the app, because context makes them clear; in the code they are different words. The app is a support app for the whole event, so words don't hang on EHBO where the meaning is broader.

## Places and what's there

| In the app | In the code | Meaning | Replaces |
| --- | --- | --- | --- |
| Locatie | `location` (table `locations`) | A place on the event map, with one lead and one open/closed | post, punt, `posts`, `postId` |
| Functie | `function` in prose, `locationFunction` in code (table `location_functions`); the list of kinds is `functionTypes` | What's at a location: water, stamp, EHBO, AED and so on | soort post, `post_types`, `post_functions`, `typeId` |
| Hoofdfunctie | `mainFunction` | The function that gives the marker its icon | `posts.type_id` |
| Bemand | `staffed` | A function people are at | `manned` |
| Locatieverantwoordelijke | `lead` | The one person who opens and closes a location | `verantwoordelijke` |
| Lid, Reserve | `member`, `reserve` | The others at a location | `lid`, `reserve` |
| Route | `route` (table `routes`) | A distance to run or walk, with its GPX | loop, parcours, `runs`, `track_json` |
| Keerpunt | `turnaround` | Where a route turns back | `keerpunt`, `posts.run_id` |
| Km-punt | `kmPoint` (table `km_points`) | A pass of a route along a location | `post_passages` |

**To decide:** #83 said the code keeps `posts`, because renaming it touches everything and brings little. #84 proposes `location`. This list follows #84; say if you'd rather keep `posts`.

## People

| In the app | In the code | Meaning | Replaces |
| --- | --- | --- | --- |
| Medewerker | `staff` | Anyone logged in with a number | |
| Deelnemer | `participant` | Anyone without logging in | |
| Beheerder | `admin` | On the admin list | |
| Kernteam | `coreTeam` | Functions without a location | `core_team` |
| Evenementcoördinator | `eventCoordinator` | Gets every request and a copy of every incident | `coordinator`, `isCoordinator`, `is_coordinator` |
| EHBO-coördinator | `firstAidCoordinator` | Participants' Bel EHBO calls them | |
| Team | `team` (tables `teams`, `team_members`) | People who go to an incident together | eenheid, `units`, `ehbo_units`, `unitId` |
| Vast, Mobiel | `fixed`, `mobile` | Kind of team | `vast`, `mobiel` |
| Te voet, Fiets, Auto, Anders | `on_foot`, `bike`, `car`, `other` | A mobile team's transport | `te_voet`, `fiets`, `auto`, `anders` |
| Standplaats | `base` | Where a mobile team waits | `postId` of a mobile unit |

## Asking for help (#86)

| In the app | In the code | Meaning | Replaces |
| --- | --- | --- | --- |
| Hulpvraag | `helpRequest` (table `help_requests`) | Everything a location or person asks for. Mostly a word for design and docs; the tab is Meldingen | `incidents` and `requests` together |
| Soort hulpvraag | `helpRequestType` (table `help_request_types`) | First aid, water, traffic, volunteer; decides how it's handled | `REQUEST_KINDS`, the split between incidents and requests |
| Afhandeling | `handling`: `dispatch` or `queue` | Sent to a team, or to the coordinator's queue | |
| Incident | `incident` | A help request of a `dispatch` type: something with someone, urgent | melding, oproep (as the whole case), EHBO-verzoek |
| Aanvraag | `request` only in prose; in code a help request of a `queue` type | Water, traffic, volunteer: not urgent | `requests`, `serviceRequest` |
| Oproep | `dispatch` (table `dispatches`) | The message to a team to go; one incident can have several | `incident_dispatches` |
| Zelf gestart | `selfStarted` | A team started the incident itself | stays |
| EHBO (eerste hulp) | `firstAid` | Where it really is first aid, e.g. the help request type `first_aid` | `ehbo` in broader names |

### Statuses (one lifecycle, #86)

| In the app | In the code | `dispatch` | `queue` | Replaces |
| --- | --- | --- | --- | --- |
| Verstuurd / Aangevraagd | `sent` | sent to a team | requested | `verstuurd`, `aangevraagd` |
| Aangenomen / Opgepakt | `accepted` | a team accepted | picked up | `geaccepteerd`, `opgepakt` |
| Ter plaatse | `on_site` | team on site | not used | `ter_plaatse` |
| Afgerond / Afgehandeld | `closed` | closed with an outcome | done | `afgerond`, `afgehandeld` |
| Ingetrokken | `withdrawn` | withdrawn | withdrawn | `ingetrokken` |

Other values: stage `nearest`, `all` (was `dichtstbij`, `alle`); dispatch reason `nearest`, `aed`, `all`, `manual` (was `handmatig`); log types `reported`, `sent`, `added`, `declined`, `escalated`, `repeated`, `accepted`, `assigned`, `on_site`, `closed`, `withdrawn`.

### What the post fills in

| In the app | In the code | Replaces |
| --- | --- | --- |
| Onwel / flauw, Gevallen / letsel, Kramp / blessure, Weet ik niet | `unwell`, `injury`, `cramp`, `unknown` | `onwel`, `letsel`, `kramp`, `onbekend` |
| Aanspreekbaar: Ja, Nee, Weet niet | `yes`, `no`, `unknown` | `ja`, `nee`, `onbekend` |
| Afloop: Ter plaatse geholpen, Gestopt, Ambulance, Doorverwezen, Hulp geweigerd, Loos alarm | `treated`, `stopped`, `ambulance`, `referred`, `refused`, `false_alarm` | `geholpen`, `gestopt`, `doorverwezen`, `geweigerd`, `loos` |
| Water, Verkeer, Vrijwilliger | types `water`, `traffic`, `volunteer` | `verkeer`, `vrijwilliger` |
| Beetje, Flink, Bijna op · Druk, Onveilig, Afzetting nodig · Aflossing nodig, Iemand valt uit, Extra hulp | `little`, `lots`, `almost_empty` · `busy`, `unsafe`, `closure` · `relief`, `dropout`, `extra` | `beetje`, `flink`, `bijna_op`, `druk`, `onveilig`, `afzetting`, `aflossing`, `uitval` |

## Being there

| In the app | In the code | Meaning | Replaces |
| --- | --- | --- | --- |
| Beschikbaar | `available` | A team can get a call | `vrij` |
| Niet beschikbaar (button: Bezet) | `unavailable` | Here, but not now | `pauze` |
| Uit dienst | `off_duty` | Not here | `uit_dienst` |
| Open, Dicht | `open`, `closed` | A location | `is_open` stays |
| Aangemeld | `loggedIn` | A device has a session | |

## Phone and screen

| In the app | In the code | Meaning |
| --- | --- | --- |
| Melding (push) | `notification` | A push message; "Meldingen aanzetten" |
| Meldingen (tab) | `help requests` in prose; route `requests` | The coordinator's list of incidents and requests |
| Mijn locatie, Positie delen | `position` | A GPS position |
| Rapport | `report` | The report only; never used for "reporting" an incident |

## Names in the code

- **Screens** are named in English after what they are, not after the design screen number: `PostHomeView` → `LocationHomeView`, `DispatchView` → `DispatchView`, `NewIncidentView` → `NewIncidentView`, `RequestView` → `RequestView`, `IncidentView` → `IncidentView`, `FirstAidView` → `FirstAidView`, and so on. `CLAUDE.md` changes its rule that a file follows the design screen.
- **Routes and URLs** are English: `/first-aid`, `/location/:id`, `/admin/...`, `/map`.
- **`localStorage` keys** start with `app.` instead of `ehbo.` (`app.outbox`, `app.queue`, `app.live`, `app.package`, `app.me`, `app.event`, `app.nav`, `app.awake`, `app.logout`, `app.seen-additions`). A phone converts its old keys once on start, so a waiting incident in the outbox survives the update.
- **`request`** in the server only means the HTTP request (`request.me`).

## How the renaming goes (#84 step 3, with #86)

1. **This list approved.**
2. **No open PRs while renaming:** every rename touches most files.
3. **One PR per concept, in this order:** user-facing texts (already mostly done); then small to large: statuses and values → people and teams → routes and screens → `localStorage` → help requests (#86, its own four steps) → locations last.
4. **Each database rename is a new migration.** Values in `CHECK` constraints need the table rebuilt. Old event files and their reports keep working; there's a test with an event file from before.
5. **The package gets a new `PACKAGE_FORMAT`.** A phone with a waiting incident or queued changes keeps them (converted on start, accepted by the server until sent).
