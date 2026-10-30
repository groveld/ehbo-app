# Testprocedure op telefoons

Een proefdag met echte telefoons, voordat we "go" of "no-go" zeggen voor de Silvesterloop. Je test alles wat op een telefoon anders kan lopen dan in de browser: installeren, pushmeldingen met het scherm uit, GPS, zonder bereik, en de oproepketen tussen meerdere toestellen.

- **Duur:** ± 2 uur, plus 30 minuten voorbereiding de dag ervoor.
- **Plek:** buiten, of met de posten op loopafstand van elkaar (GPS werkt binnen slecht). Ergens met 4G; wifi mag ook, maar test "geen bereik" dan met vliegtuigmodus.
- **De testmodus staat de hele proefdag aan**, zodat niets in het rapport komt.

## Wat je nodig hebt

| Wat | Waarom |
| --- | --- |
| **6 telefoons**, minstens 2 iPhones (iOS 16.4 of nieuwer) en 2 Android-toestellen (Chrome) | Elke rol op een eigen toestel; iOS en Android gedragen zich anders bij meldingen en installeren |
| **1 laptop** met Chrome of Edge | Beheer, rapport (PDF en CSV) |
| **5 mensen** (de deelnemer kan één van hen zijn, op een eigen toestel) | Oproepen gaan tussen toestellen heen en weer; met één persoon per toestel test je ook "scherm uit" eerlijk |
| Van elke tester het **mobiele nummer** | Voor de rollen in beheer (stap V2) |
| Opladers of powerbanks | GPS en meldingen kosten stroom |
| Een **PNG van 512 × 512** (vierkant logo) | Test van het eigen app-icoon |
| Excel of Numbers op de laptop | CSV-export openen |
| Deze lijst, geprint of gedeeld, met een pen | Per stap afvinken; bij een fout noteren: toestel, iOS/Android-versie, tijd, schermafbeelding |

## Rollen en toestellen

| Toestel | Rol | Wat zet je in beheer |
| --- | --- | --- |
| **A** laptop + telefoon | Beheerder én evenementcoördinator | Nummer bij Beheerders, en in Kernteam bij *Evenementcoördinator* (centraal) |
| **B** telefoon | Postverantwoordelijke, Post 1 (bijv. waterpost) | Contactpersoon bij Post 1, rol *verantwoordelijke* |
| **C** telefoon | Lid van Post 1 | Contactpersoon bij Post 1, rol *lid* |
| **D** telefoon | EHBO, vaste eenheid **met AED**, en EHBO-coördinator | Lid van Team 1 (vast, eigen EHBO-post, AED aan); in Kernteam bij *EHBO-coördinator* |
| **E** telefoon | EHBO, mobiele eenheid zonder AED | Lid van Team 2 (mobiel, te voet of fiets, standplaats Post 2) |
| **F** telefoon | Deelnemer | Niets; opent de app zonder aan te melden |

Neem voor D en E bij voorkeur een iPhone en een Android-toestel, zodat je de oproep op allebei ziet.

## Voorbereiding (de dag ervoor, toestel A)

| # | Stap | Klaar als |
| --- | --- | --- |
| V1 | Beheer › Evenement: naam en datum invullen, een loop toevoegen met GPX | Loop staat in de lijst met afstand |
| V2 | Beheer › Posten: Post 1 (B en C), Post 2 en een EHBO-post, elk met GPS-positie op de testplek. Leg Post 1 het dichtst bij Team 2's standplaats, de EHBO-post verder weg | Posten staan op de kaart; de afstanden zijn duidelijk verschillend |
| V3 | Beheer › EHBO-eenheden: Team 1 (vast, EHBO-post, AED) met D, Team 2 (mobiel, standplaats Post 2) met E | Beide eenheden staan in de lijst |
| V4 | Beheer: Kernteam (A als evenementcoördinator, D als EHBO-coördinator) en noodnummers (Spoedeisende Hulp, Huisartsenpost) | Lijsten tonen de namen en nummers |
| V5 | Beheer › Evenement › **Kaart ophalen** | Na ± 10–30 s: "… kaarttegels opgeslagen" |
| V6 | Beheer › **Rapport en testmodus** › Testmodus aan | Op elk scherm de gele balk "Testmodus" |
| V7 | Het adres (`https://silvesterloop.groveld.com`) naar alle testers sturen, of als QR-code klaarleggen | — |

## Blok 1 · Installeren en aanmelden (alle telefoons behalve F)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 1.1 | A–E | Adres openen in Safari (iPhone) of Chrome (Android) | "Zet de app eerst op je beginscherm", met het juiste toestel herkend | |
| 1.2 | A–E | iPhone: Deel › **Zet op beginscherm**. Android: **Installeren** | Icoon met de korte naam op het beginscherm | |
| 1.3 | A–E | App openen vanaf het beginscherm › **Medewerker / vrijwilliger** › eigen nummer | "Hoi …" met de juiste functies | |
| 1.4 | één toestel | Een onbekend nummer invullen | "Dit nummer staat niet in de lijst" met een belknop | |
| 1.5 | A–E | **Klopt, start** › meldingen en locatie **Aanzetten** | Toestemmingsvragen; daarna allebei aan | |
| 1.6 | A–E | **Stuur testmelding** | Melding verschijnt binnen enkele seconden | |
| 1.7 | A–E | **Klaar, naar mijn startscherm** | B, C: Post 1. D, E: EHBO. A: Post (als A bij een post staat) of de kaart | |
| 1.8 | A–E | Tabbalk bekijken | B, C: Mijn post, Kaart, Contacten, Menu. D, E: EHBO, Kaart, Contacten, Menu. A: ook **Meldingen** | |
| 1.9 | A–E | Menu | Bovenaan je naam en nummer, daaronder je functies (beheer eerst) | |

Lukt 1.5 niet op een iPhone: controleer iOS 16.4 of nieuwer en dat de app vanaf het beginscherm is geopend, niet in Safari.

## Blok 2 · Meldingen, locatie en GPS (alle telefoons behalve F)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 2.1 | A–E | Menu › **Pushmeldingen, locatie en controle** | Alles groen: geïnstalleerd, service worker actief, meldingen en locatie toegestaan, server bereikbaar | |
| 2.2 | A–E | **Over 10 s** en meteen het scherm vergrendelen | Melding op het vergrendelscherm, met geluid of trilling | |
| 2.3 | A–E | Buiten: **Test GPS** | Positie en nauwkeurigheid; groen bij 15 m of beter | |
| 2.4 | E | EHBO › **Beschikbaar**, dan 2.1 opnieuw | "Positie delen (mobiele EHBO): actief" | |
| 2.5 | A–E | App volledig afsluiten en opnieuw openen | Nog steeds aangemeld, op hetzelfde startscherm | |

## Blok 3 · Zonder bereik (alle telefoons behalve F)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 3.1 | A–E | Vliegtuigmodus aan, app afsluiten en openen | App opent, nog steeds aangemeld | |
| 3.2 | A–E | Kaart, Contacten, een postpagina openen | Kaart met posten en parcours; contacten en postgegevens staan er | |
| 3.3 | A–E | Op een contact **bellen**; op een post **Navigeer** | De telefoon-app en de navigatie-app openen | |
| 3.4 | A–E | Vliegtuigmodus uit | Na enkele seconden weer live (bijv. een open melding verschijnt) | |

## Blok 4 · EHBO-oproep, de normale weg (B, D, E, A)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 4.1 | D, E | EHBO › **Beschikbaar** | Groen blok "Beschikbaar" | |
| 4.2 | E | Scherm vergrendelen, telefoon wegleggen | — | |
| 4.3 | B | **Post openen** › tegel **EHBO** › *Onwel / flauw* › aanspreekbaar **ja** › **EHBO-verzoek versturen** | "We zoeken een EHBO'er" met aftellen | |
| 4.4 | E | — | Binnen 5 s een oproep met alarm, ook met scherm uit. Tik op de melding: de oproep opent direct | |
| 4.5 | E | Tabbalk | Rood getal op **EHBO** | |
| 4.6 | A | — | Pushmelding met een kopie van de oproep; tik erop: die melding opent. Op **Meldingen** een kaart met label **EHBO** | |
| 4.7 | E | **Accepteren & navigeren** | Navigatie-app opent naar Post 1 | |
| 4.8 | B | — | "Hulp is onderweg" met naam en belknop van E | |
| 4.9 | E | Terug naar de app › **Ik ben ter plaatse** | B ziet dat de EHBO er is | |
| 4.10 | E | **Incident afronden** › afloop kiezen › **Afronden & weer beschikbaar** | E staat op Beschikbaar; de oproep staat onder *Vandaag* | |
| 4.11 | A | Meldingen | De oproep staat onder *Afgerond* | |

## Blok 5 · Escalatie en "kan niet" (B, D, E, A)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 5.1 | D, E | Beide op **Beschikbaar** | — | |
| 5.2 | B | Nieuw EHBO-verzoek (aanspreekbaar **ja**) | Oproep naar de dichtstbijzijnde beschikbare eenheid (volgens V2: Team 2, E) | |
| 5.3 | E | Niet reageren | Na **30 s** gaat de oproep naar alle beschikbare eenheden: ook D krijgt het alarm | |
| 5.4 | D, E | Niet reageren | Na **60 s** krijgt A een alarm: "Nog niemand heeft de oproep aangenomen" | |
| 5.5 | D | **Accepteren** | E krijgt "Oproep is al aangenomen"; de rest gaat als in blok 4 | |
| 5.6 | B, E | Nieuw verzoek; E tikt **Kan niet** | De oproep gaat direct naar alle beschikbare eenheden (zonder 30 s te wachten) | |
| 5.7 | B | Bij een lopende oproep: **Melding intrekken** | D en E krijgen "Melding ingetrokken" | |

## Blok 6 · AED-regel (B, D, E)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 6.1 | D, E | Beide op **Beschikbaar** | — | |
| 6.2 | B | EHBO-verzoek met aanspreekbaar **nee** | B ziet "Bel ook 112". **D en E krijgen tegelijk** een oproep: de dichtstbijzijnde (E) én de dichtstbijzijnde met AED (D), met "AED meenemen" | |
| 6.3 | D | Accepteren, afronden | — | |

## Blok 7 · Geen bereik bij de post (B, E)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 7.1 | B | Vliegtuigmodus aan › **EHBO** › versturen | Scherm "Bel de EHBO direct" met belknoppen naar de dichtstbijzijnde eenheid en de coördinator | |
| 7.2 | B | Vliegtuigmodus uit | De melding gaat vanzelf weg en E krijgt de oproep | |
| 7.3 | E | Afronden met **Afronden & pauze** | E staat op Pauze: rode kop *Niet beschikbaar*; geen nieuwe oproepen | |
| 7.4 | B | Nieuw EHBO-verzoek | Gaat **niet** naar E (pauze), wel naar D | |
| 7.5 | D, E | D handelt af; E zet zichzelf weer op **Beschikbaar** | — | |

## Blok 8 · Post open en dicht (B, C, A)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 8.1 | C | Mijn post | Ziet de post, maar kan hem niet openen of sluiten | |
| 8.2 | B | Rechtsboven **Post sluiten** › bevestigen | Post is dicht; op de kaart grijs; de verzoektegels werken niet meer | |
| 8.3 | A | Kaart › Post 1 › schakelaar **Post open** | De post gaat open; B ziet het direct | |

## Blok 9 · Aanvragen (B, A)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 9.1 | B | Tegel **Water** › **Bijna op** | B ziet de plek in de wachtrij | |
| 9.2 | A | — | Pushmelding; tik erop: **Meldingen** opent. Teller **1** op het tabblad; kaart met label **Water** | |
| 9.3 | A | **Oppakken** | B krijgt "wordt geregeld" met de naam van A | |
| 9.4 | A | **Afgehandeld** | B krijgt "afgehandeld"; de kaart staat onder *Afgerond* | |
| 9.5 | B | Ook **Verkeer** en **Vrijwilliger** aanvragen | Elk met een eigen label op Meldingen | |

## Blok 10 · Deelnemer (F)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 10.1 | F | Adres openen › **Deelnemer** (niet installeren) | De naam van het evenement als titel, kaart met parcours, starttijden, posten langs de route | |
| 10.2 | F | Geen namen of telefoonnummers te zien | — | |
| 10.3 | F | **Bel EHBO** | Belt D (de EHBO-coördinator) | |
| 10.4 | F | Ster bij een loop, en een tik op een andere loop | De favoriet staat vooraan en blijft staan; de andere loop is alleen op de kaart gemarkeerd | |
| 10.5 | F | Rechtsboven **Sluiten** | Terug op het welkomscherm | |

## Blok 11 · Beheer en rapport (laptop A)

| # | Toestel | Stap | Verwacht | ✓ |
| --- | --- | --- | --- | --- |
| 11.1 | A | Beheer › Evenement › hoofdkleur donkerrood (bijv. `#B3261E`) kiezen › opslaan | Geweigerd: "lijkt op rood of groen" | |
| 11.2 | A | Vierkant logo (PNG 512 × 512) en korte naam › opslaan. Op één telefoon de app verwijderen en opnieuw op het beginscherm zetten | Eigen icoon met de korte naam; de testmelding toont hetzelfde icoon | |
| 11.3 | A | Beheer › Post 1 › **Herkenbare plek of adres** invullen › opslaan | Op de postpagina staat dat adres onder *Locatie* | |
| 11.4 | A | Beheer › **Info & voorwaarden** aanpassen; op een telefoon Menu › Info | De nieuwe tekst | |
| 11.5 | A | Beheer › Rapport | Geen proefoproepen in de cijfers (testmodus) | |
| 11.6 | A | Testmodus uit; één echte oproep (blok 4, kort) | Die oproep staat wél in het rapport | |
| 11.7 | A | **PDF-export** › Opslaan als PDF; **CSV-export** openen in Excel | PDF met logo, totalen en het incident; CSV opent met kolommen en goede tekens (ë, ö) | |

## Na afloop

1. **Testmodus weer aan** tot het evenement, of de testoproep uit 11.6 laten staan en vlak voor het evenement controleren dat de testmodus uit staat.
2. Per fout een GitHub-issue: blok en stap, toestel, iOS/Android-versie, wat je zag, en een schermafbeelding.
3. **Go** als blok 1, 2, 4, 5, 6 en 7 op alle toestellen werken. Meldingen met scherm uit (2.2, 4.4) en het alarm na 30 en 60 s (5.3, 5.4) zijn de belangrijkste. Een fout in blok 9–11 is geen no-go, als er een plan is om het vóór week 52 op te lossen.
