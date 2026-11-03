// De oproepketen van begin tot eind, met twee telefoons: een post en een EHBO-eenheid (testgegevens uit server/src/demo.ts).
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

const PHONE = { admin: '0600000001', postLead: '0600000004', postMember: '0600000005', mobileEhbo: '0600000006', coordinator: '0600000002' } as const;

/** Nieuwe telefoon: aanmelden zoals een medewerker, tot het startscherm. */
async function staffPhone(browser: Browser, phone: string, gps?: { latitude: number; longitude: number }): Promise<Page> {
  const context = await browser.newContext({
    ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3090', locale: 'nl-NL', timezoneId: 'Europe/Amsterdam',
    ...(gps ? { geolocation: { ...gps, accuracy: 15 }, permissions: ['geolocation'] } : {}),
  });
  // Navigeren opent Google Maps; dat vangen we af, zodat de test bij de app blijft.
  await context.addInitScript(() => localStorage.setItem('ehbo.nav', JSON.stringify('google')));
  await context.route('https://www.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Kaarten</title>' }));
  const page = await context.newPage();
  await page.goto('/?browser=1');
  await page.getByRole('link', { name: 'Aanmelden' }).click();
  await page.getByLabel('Je mobiele nummer').fill(phone);
  await page.getByRole('button', { name: 'Verder' }).click();
  await page.getByRole('button', { name: 'Klopt, start' }).click();
  await page.getByRole('link', { name: 'Klaar, naar mijn startscherm' }).click();
  return page;
}

/** The map on its tab is as tall as the layout says, not squeezed. */
async function expectFullMap(page: Page) {
  const heights = await page.locator('.map').first().evaluate((map) => [map.getBoundingClientRect().height, Math.min(480, Math.max(240, innerHeight * 0.4))]);
  expect(heights[0]).toBeCloseTo(heights[1]!, 0);
}

/** The service worker has everything: from here on the app works without a network. */
const installed = (page: Page) => page.waitForFunction(async () => {
  await navigator.serviceWorker.ready;
  return Boolean(navigator.serviceWorker.controller);
});

test('aanmelden → post open → EHBO-verzoek → oproep → accepteren → ter plaatse → afronden', async ({ browser }) => {
  const ehbo = await staffPhone(browser, PHONE.mobileEhbo);
  await expect(ehbo.getByRole('heading', { name: /Uit dienst|Beschikbaar/ })).toBeVisible();
  await ehbo.getByRole('button', { name: 'Beschikbaar', exact: true }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();

  const post = await staffPhone(browser, PHONE.postLead);
  await expect(post.getByRole('heading', { name: 'Waterpost 3 · brug' })).toBeVisible();
  await expect(post.getByText('LOCATIE IS DICHT')).toBeVisible();
  await post.getByRole('button', { name: 'Locatie openen' }).click();
  await expect(post.getByText('Wat heb je nodig?')).toBeVisible();

  await post.getByRole('link', { name: /EHBO/ }).first().click();
  await post.getByRole('button', { name: 'Onwel / flauw' }).click();
  await post.getByRole('button', { name: '1', exact: true }).click();
  await post.getByRole('button', { name: 'EHBO-verzoek versturen' }).click();
  await expect(post.getByRole('heading', { name: "We zoeken een EHBO'er" })).toBeVisible();
  await expect(post.getByText(/Team 2.*wordt opgeroepen/)).toBeVisible();

  // De EHBO-telefoon gaat vanzelf naar de oproep (live via SSE).
  await expect(ehbo.getByRole('heading', { name: 'Waterpost 3 · brug' })).toBeVisible({ timeout: 10_000 });
  await expect(ehbo.getByText('Onwel / flauw · 1 persoon')).toBeVisible();
  await expect(ehbo.getByRole('img', { name: /Nog \d+ seconden/ })).toBeVisible();
  await ehbo.getByRole('button', { name: 'Accepteren & navigeren' }).click();
  await ehbo.waitForURL(/google\.com\/maps/);
  await ehbo.goBack();

  await expect(post.getByRole('heading', { name: 'Hulp is onderweg' })).toBeVisible({ timeout: 10_000 });
  await expect(post.locator('.helper').getByText('Mo Mobiel')).toBeVisible();

  await expect(ehbo.getByText(/Onderweg · sinds/i)).toBeVisible();
  // En route: everything the post entered.
  await expect(ehbo.locator('.details')).toContainText('Onwel / flauw');
  await expect(ehbo.locator('.details')).toContainText('1 persoon');
  await ehbo.getByRole('button', { name: 'Ik ben ter plaatse' }).click();
  await expect(post.getByRole('heading', { name: 'EHBO is er' })).toBeVisible({ timeout: 10_000 });

  // On site goes straight to closing; the back arrow returns to the call, and nothing has closed.
  await expect(ehbo.getByRole('heading', { name: 'Incident afronden' })).toBeVisible();
  await ehbo.getByRole('button', { name: 'Terug' }).click();
  await ehbo.getByRole('link', { name: 'Incident afronden' }).click();
  await ehbo.getByRole('button', { name: 'Ter plaatse geholpen' }).click();
  await ehbo.getByLabel('Korte notitie').fill('Gekoeld en drinken gegeven');
  await ehbo.getByRole('button', { name: 'Afronden & weer beschikbaar' }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();
  await ehbo.getByRole('link', { name: /Mijn inzetten/ }).click();
  const deployment = ehbo.locator('.deployment').filter({ hasText: 'Waterpost 3 · brug' }).filter({ hasText: 'Onwel' }).first();
  await deployment.click();
  await expect(ehbo.getByRole('heading', { name: 'Klaar' })).toBeVisible();
  await expect(ehbo.locator('.tab.active')).toContainText('EHBO');
  await ehbo.getByRole('button', { name: 'Terug' }).click();
  await expect(ehbo.getByRole('heading', { name: 'Mijn inzetten' })).toBeVisible();

  await expect(post.getByRole('heading', { name: 'Klaar' })).toBeVisible({ timeout: 10_000 });
  await expect(post.getByText('Ter plaatse geholpen')).toBeVisible();
});

test('zonder bereik: bellen, en de melding gaat vanzelf weg zodra er weer bereik is', async ({ browser }) => {
  const post = await staffPhone(browser, PHONE.postLead);
  // Na de vorige test staat de post nog open; anders openen.
  const open = post.getByRole('button', { name: 'Locatie openen' });
  if (await open.isVisible()) await open.click();
  await post.getByRole('link', { name: /EHBO/ }).first().click();

  await post.context().setOffline(true);
  await post.getByRole('button', { name: 'Kramp / blessure' }).click();
  await post.getByRole('button', { name: 'EHBO-verzoek versturen' }).click();
  await expect(post.getByRole('heading', { name: 'Bel de EHBO direct' })).toBeVisible();
  await expect(post.getByRole('link', { name: /Bel Team/ }).first()).toBeVisible();
  await expect(post.getByText('Melding staat klaar en gaat automatisch weg zodra er bereik is.')).toBeVisible();

  await post.context().setOffline(false);
  await expect(post.getByRole('heading', { name: "We zoeken een EHBO'er" })).toBeVisible({ timeout: 20_000 });
  await expect(post.getByText('Kramp / blessure')).toBeVisible();

  // Opruimen, en meteen intrekken getest.
  await post.getByRole('button', { name: 'Melding intrekken' }).click();
  await post.getByRole('dialog').getByRole('button', { name: 'Melding intrekken' }).click();
  await expect(post.getByText('Wat heb je nodig?')).toBeVisible();
  await post.getByRole('button', { name: 'Locatie sluiten' }).click();
  await expect(post.getByRole('dialog').getByText(/altijd weer openen/)).toBeVisible();
  await post.getByRole('dialog').getByRole('button', { name: 'Locatie sluiten' }).click();
  await expect(post.getByText('LOCATIE IS DICHT')).toBeVisible();
});

test('aanvraag water: post vraagt aan, coördinator pakt op en handelt af', async ({ browser }) => {
  const post = await staffPhone(browser, PHONE.postLead);
  await post.getByRole('button', { name: 'Locatie openen' }).click();
  await post.getByRole('button', { name: /^Water/ }).click();
  await expect(post.getByRole('heading', { name: 'Water aangevraagd' })).toBeVisible();
  await expect(post.getByText(/Plek 1 in de wachtrij/)).toBeVisible();
  await post.getByRole('button', { name: 'Bijna op' }).click();
  await expect(post.getByRole('button', { name: 'Bijna op' })).toHaveAttribute('aria-pressed', 'true');

  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Meldingen' }).click();
  const card = coordinator.locator('.request').filter({ hasText: 'Waterpost 3' });
  await expect(card).toContainText('bijna op');
  await coordinator.getByRole('link', { name: 'Kaart' }).click();
  await expect(coordinator.locator('.post-marker.task')).toHaveCSS('animation-iteration-count', 'infinite');
  await coordinator.getByRole('link', { name: 'Meldingen' }).click();
  await card.getByRole('button', { name: 'Oppakken' }).click();
  await expect(card).toContainText('Opgepakt door jou');
  await expect(post.getByText('Cor Coördinator regelt het.')).toBeVisible({ timeout: 10_000 });

  await card.getByRole('button', { name: 'Afgehandeld' }).click();
  await expect(post.getByRole('heading', { name: 'Water: afgehandeld' })).toBeVisible({ timeout: 10_000 });

  // Looked back at later: from the queue, and from the post.
  await coordinator.locator('.request').filter({ hasText: 'Afgehandeld' }).filter({ hasText: 'Waterpost 3' }).first().getByRole('link').click();
  await expect(coordinator.getByRole('heading', { name: 'Water: afgehandeld' })).toBeVisible();
  await expect(coordinator.getByText('Opgepakt door Cor Coördinator')).toBeVisible();

  await post.getByRole('button', { name: 'Terug naar mijn locatie' }).click();
  await post.getByRole('link', { name: /Eerder vandaag/ }).click();
  await post.getByRole('link', { name: /Water.*afgehandeld/ }).first().click();
  await expect(post.getByRole('heading', { name: 'Water: afgehandeld' })).toBeVisible();
  await post.getByRole('button', { name: 'Terug', exact: true }).click();
  await expect(post.getByRole('heading', { name: 'Eerder vandaag' })).toBeVisible();
  await post.getByRole('link', { name: 'Terug' }).click();
  await post.getByRole('button', { name: 'Locatie sluiten' }).click();
  await expect(post.getByRole('dialog').getByText(/altijd weer openen/)).toBeVisible();
  await post.getByRole('dialog').getByRole('button', { name: 'Locatie sluiten' }).click();
  await expect(post.getByText('LOCATIE IS DICHT')).toBeVisible();
});

test('zonder bereik: de EHBO rondt af, de post vraagt water, en alles gaat later door', async ({ browser }) => {
  const ehbo = await staffPhone(browser, PHONE.mobileEhbo);
  const post = await staffPhone(browser, PHONE.postLead);
  await ehbo.getByRole('button', { name: 'Beschikbaar', exact: true }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();
  await post.getByRole('button', { name: 'Locatie openen' }).click();
  await post.getByRole('link', { name: /EHBO/ }).first().click();
  await post.getByRole('button', { name: 'EHBO-verzoek versturen' }).click();
  await ehbo.getByRole('button', { name: 'Accepteren & navigeren' }).click();
  await ehbo.waitForURL(/google\.com\/maps/);
  await ehbo.goBack();
  await expect(ehbo.getByRole('button', { name: 'Ik ben ter plaatse' })).toBeVisible();

  // Signal gone: everything still goes on, and every screen says so.
  await installed(ehbo);
  await installed(post);
  await ehbo.context().setOffline(true);
  await post.context().setOffline(true);
  await expect(ehbo.locator('.offline-pill')).toBeVisible();
  await ehbo.getByRole('button', { name: 'Ik ben ter plaatse' }).click();
  await ehbo.getByRole('button', { name: 'Ter plaatse geholpen' }).click();
  await ehbo.getByRole('button', { name: 'Afronden & weer beschikbaar' }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();

  await post.locator('.tabbar').getByRole('link', { name: 'Waterpost 3' }).click();
  await post.getByRole('button', { name: /^Water/ }).click();
  await expect(post.getByRole('heading', { name: 'Water aangevraagd' })).toBeVisible();
  await post.getByRole('button', { name: 'Flink' }).click();
  await expect(post.getByRole('button', { name: 'Flink' })).toHaveAttribute('aria-pressed', 'true');

  // The app starts without any network too.
  await ehbo.reload();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();

  // Signal back: it all reaches the server, in order, and nothing is lost or done twice.
  await ehbo.context().setOffline(false);
  await post.context().setOffline(false);
  await expect(ehbo.locator('.offline-pill')).toBeHidden({ timeout: 20_000 });
  await expect(post.locator('.offline-pill')).toBeHidden({ timeout: 20_000 });
  await expect(post.getByRole('button', { name: 'Flink' })).toHaveAttribute('aria-pressed', 'true');
  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Meldingen' }).click();
  const card = coordinator.locator('.request').filter({ hasText: 'flink' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Oppakken' }).click();
  await card.getByRole('button', { name: 'Afgehandeld' }).click();
  await expect(coordinator.locator('.incident').filter({ hasText: 'afgerond' }).first()).toBeVisible();

  await post.getByRole('button', { name: 'Terug naar mijn locatie' }).click();
  await post.getByRole('button', { name: 'Locatie sluiten' }).click();
  await post.getByRole('dialog').getByRole('button', { name: 'Locatie sluiten' }).click();
  await expect(post.getByText('LOCATIE IS DICHT')).toBeVisible();
});

test('closing: the warning on the post, keep open without signal, and everything at once', async ({ browser }) => {
  const post = await staffPhone(browser, PHONE.postLead);
  const open = post.getByRole('button', { name: 'Locatie openen' });
  // Wait for the screen: open or closed, depending on the test before.
  await expect(open.or(post.getByText('Wat heb je nodig?'))).toBeVisible();
  if (await open.isVisible()) await open.click();
  await expect(post.getByText('Wat heb je nodig?')).toBeVisible();
  await installed(post);
  // Opening the post has reached the server; a change still in the queue would go over the warning.
  await post.waitForFunction(() => !localStorage.getItem('ehbo.queue'));

  // The server's warning, as the phone has saved it.
  await post.context().setOffline(true);
  await post.evaluate(() => {
    const live = JSON.parse(localStorage.getItem('ehbo.live')!);
    for (const p of live.posts) p.closesAt = '2026-12-31T13:00:00.000Z';
    localStorage.setItem('ehbo.live', JSON.stringify(live));
  });
  await post.reload();
  await expect(post.getByText(/Deze locatie sluit om/)).toBeVisible();
  await post.getByRole('button', { name: 'Open houden' }).click();
  await expect(post.getByText(/Deze locatie sluit om/)).toBeHidden();
  await post.context().setOffline(false);
  await expect(post.locator('.offline-pill')).toBeHidden({ timeout: 20_000 });

  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Menu' }).click();
  await coordinator.getByRole('link', { name: /Locaties en EHBO openen/ }).click();
  await coordinator.getByRole('button', { name: 'Alles openen' }).click();
  await coordinator.getByRole('dialog').getByRole('button', { name: 'Alles openen' }).click();
  // Nobody has logged in for Team 1, so it stays closed with its post, and says so.
  await expect(coordinator.getByRole('dialog')).toContainText('Niemand aangemeld: EHBO-post 1 · start, Team 1');
  await coordinator.getByRole('dialog').getByRole('button', { name: 'Begrepen' }).click();
  await expect(coordinator.getByText('Locaties open').locator('..')).toContainText('/');
  await coordinator.getByRole('button', { name: 'Dag sluiten' }).click();
  await coordinator.getByRole('dialog').getByRole('button', { name: 'Dag sluiten' }).click();
  await expect(post.getByText('LOCATIE IS DICHT')).toBeVisible({ timeout: 10_000 });
});

test('rapport: cijfers, CSV, afdrukpagina en de testmodus', async ({ browser }) => {
  const admin = await staffPhone(browser, PHONE.admin);
  await admin.goto('/beheer/rapport');
  await expect(admin.getByRole('heading', { name: 'Rapport' })).toBeVisible();
  // De eerste test rondde een oproep af bij de waterpost.
  await expect(admin.getByText(/Waterpost 3/).first()).toBeVisible();
  await expect(admin.getByText('geholpen').first()).toBeVisible();

  const download = admin.waitForEvent('download');
  await admin.getByRole('link', { name: 'CSV-export' }).click();
  expect((await download).suggestedFilename()).toBe('rapport-2026-12-31.csv');

  await admin.getByRole('link', { name: 'PDF-export' }).click();
  await expect(admin.getByRole('heading', { name: 'Rapport Silvesterloop 2026' })).toBeVisible();
  await expect(admin.getByRole('cell', { name: 'Ter plaatse geholpen' }).first()).toBeVisible();
  await admin.getByRole('button', { name: 'Terug' }).click();

  await admin.getByRole('switch', { name: 'Testmodus' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Testmodus aanzetten' }).click();
  await expect(admin.getByText('Testmodus · oproepen zijn proef')).toBeVisible({ timeout: 10_000 });
  await admin.getByRole('switch', { name: 'Testmodus' }).click();
  await expect(admin.getByText('Testmodus · oproepen zijn proef')).toBeHidden({ timeout: 10_000 });
});

test('beheer: info-pagina aanpassen en een post open en dicht zetten', async ({ browser }) => {
  const admin = await staffPhone(browser, PHONE.admin);
  await admin.goto('/beheer/info');
  await admin.getByLabel('Contact voor vragen ({contact})').fill('Bea, beheer@example.org');
  await admin.getByLabel('Kop van onderdeel 1').fill('Over {evenement}');
  await admin.getByRole('button', { name: 'Opslaan' }).click();
  await expect(admin.getByText('Opgeslagen.')).toBeVisible();
  await admin.getByRole('link', { name: 'Bekijk de info-pagina' }).click();
  await expect(admin.getByText('Over Silvesterloop 2026')).toBeVisible();
  await expect(admin.getByText(/Bea, beheer@example\.org/)).toBeVisible();

  await admin.goto('/overzicht/kaart');
  await admin.getByRole('link', { name: /Kruising 4/ }).first().click();
  await expect(admin.getByText('Locatie is dicht')).toBeVisible();
  await admin.getByRole('switch', { name: 'Locatie open' }).click();
  await expect(admin.getByText('Locatie is open')).toBeVisible();
  await admin.getByRole('switch', { name: 'Locatie open' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Locatie sluiten' }).click();
  await expect(admin.getByText('Locatie is dicht')).toBeVisible();

  // Terug naar de standaardtekst, zodat een volgende ronde hetzelfde begint.
  await admin.goto('/beheer/info');
  await admin.getByRole('button', { name: 'Terug naar de standaardtekst' }).click();
  await admin.getByRole('dialog').getByRole('button', { name: 'Standaardtekst gebruiken' }).click();
  await expect(admin.getByText('Opgeslagen.')).toBeVisible();
});

test('geen vorige pagina om naar te vegen; terug in de app gaat één stap omhoog', async ({ browser }) => {
  const post = await staffPhone(browser, PHONE.postLead);
  await expect(post.getByRole('heading', { name: 'Waterpost 3 · brug' })).toBeVisible();
  const home = new URL(post.url()).pathname;
  const length = await post.evaluate(() => history.length);
  const terug = () => post.getByRole('button', { name: 'Terug' }).or(post.getByRole('link', { name: 'Terug' })).first().click();

  // Kaart → postdetail → terug: de kaart.
  await post.getByRole('link', { name: 'Kaart' }).click();
  await post.locator('.post-row .main').first().click();
  await expect(post).toHaveURL(/\/post\/\d+$/);
  await terug();
  await expect(post).toHaveURL(/\/overzicht\/kaart$/);

  // Menu › Info → terug: het menu.
  await post.getByRole('link', { name: 'Menu' }).click();
  await post.getByRole('link', { name: /Info/ }).click();
  await expect(post).toHaveURL(/\/info$/);
  await terug();
  await expect(post).toHaveURL(/\/menu$/);
  await post.locator(`.tabbar a[href="${home}"]`).click();
  await expect(post).toHaveURL((url) => url.pathname === home);

  // Elke stap vervangt de vorige: de geschiedenis groeit niet, dus vegen heeft niets om te tonen.
  expect(await post.evaluate(() => history.length)).toBe(length);

  // Beheer: de terugpijl gaat steeds naar het scherm erboven.
  const admin = await staffPhone(browser, PHONE.admin);
  await admin.getByRole('link', { name: 'Menu' }).click();
  await admin.getByRole('link', { name: 'Beheer' }).click();
  await admin.getByRole('link', { name: /Locaties/ }).first().click();
  await admin.locator('a[href^="/beheer/posten/"]').first().click();
  await expect(admin).toHaveURL(/\/beheer\/posten\/\w+$/);
  for (const path of [/\/beheer\/posten$/, /\/beheer$/, /\/menu$/]) {
    await admin.getByRole('link', { name: 'Terug' }).click();
    await expect(admin).toHaveURL(path);
  }
});

test('participant: looking at a run keeps the favorites, and there can be several', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3090', locale: 'nl-NL' });
  const page = await context.newPage();
  await page.goto('/?browser=1');
  const { runs } = await (await page.request.get('/api/package')).json() as { runs: { name: string }[] };
  expect(runs.length).toBeGreaterThanOrEqual(3);
  const [first, second, third] = runs.map((r) => r.name);
  const star = (name: string) => page.getByRole('button', { name: `Favoriet: ${name}` });

  await star(third!).click();
  await star(second!).click();
  await expect(star(first!)).toHaveAttribute('aria-pressed', 'false');
  await expect(star(second!)).toHaveAttribute('aria-pressed', 'true');
  await expect(star(third!)).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(star(second!)).toHaveAttribute('aria-pressed', 'true');
  await expect(star(third!)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.run-name').first()).toHaveText(second!);

  // Info & voorwaarden below the legend, out from under Bel EHBO, and back again.
  const info = page.getByRole('link', { name: 'Info & voorwaarden' });
  await info.scrollIntoViewIfNeeded();
  const [link, call] = [await info.boundingBox(), await page.locator('.call-ehbo').boundingBox()];
  expect(link!.y + link!.height <= call!.y || link!.x + link!.width <= call!.x).toBe(true);
  await info.click();
  await expect(page.getByRole('link', { name: 'OpenStreetMap-bijdragers' })).toBeVisible();
  await page.getByRole('button', { name: 'Terug' }).click();
  await expect(page.getByText('Legenda')).toBeVisible();
  await context.close();
});

test('a new post in admin: open phones get it by themselves, and a call works before the package has arrived', async ({ browser }) => {
  const NEW_POST = 'Waterpost 9 · nieuw';
  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Kaart' }).click();
  await expect(coordinator).toHaveURL(/\/overzicht\/kaart$/);

  const ehbo = await staffPhone(browser, PHONE.mobileEhbo);
  await ehbo.getByRole('button', { name: 'Beschikbaar', exact: true }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();
  // This phone can't fetch the package, so it only knows what the call itself says.
  await ehbo.route('**/api/package', (route) => route.abort());

  const admin = await staffPhone(browser, PHONE.admin);
  const { postTypes } = await (await admin.request.get('/api/package')).json() as { postTypes: { id: number; key: string }[] };
  const created = await admin.request.post('/api/admin/posts', {
    data: {
      functionIds: [postTypes.find((t) => t.key === 'water')!.id], runId: null, name: NEW_POST, lat: 53.16, lng: 5.84, accuracyM: null, address: null, accessRoute: null,
      timeFrom: null, timeTo: null, contacts: [{ name: 'Nieuwe Leider', phone: '0600000011', role: 'lead', timeFrom: null, timeTo: null }],
    },
  });
  expect(created.ok()).toBe(true);

  // Nobody reloads: the coordinator's list shows the new post by itself.
  await expect(coordinator.locator('.post-row').filter({ hasText: NEW_POST })).toBeVisible({ timeout: 15_000 });

  const post = await staffPhone(browser, '0600000011');
  await expect(post.getByRole('heading', { name: NEW_POST })).toBeVisible();
  await post.getByRole('button', { name: 'Locatie openen' }).click();
  await post.getByRole('link', { name: /EHBO/ }).first().click();
  await post.getByRole('button', { name: 'Onwel / flauw' }).click();
  await post.getByRole('button', { name: '1', exact: true }).click();
  await post.getByRole('button', { name: 'EHBO-verzoek versturen' }).click();
  await expect(post.getByRole('heading', { name: "We zoeken een EHBO'er" })).toBeVisible();

  await expect(ehbo.getByRole('heading', { name: NEW_POST })).toBeVisible({ timeout: 10_000 });
  const id = /\/oproep\/(\d+)/.exec(ehbo.url())![1];
  await ehbo.getByRole('button', { name: 'Accepteren & navigeren' }).click();
  await ehbo.waitForURL(/google\.com\/maps/);
  await ehbo.goBack();
  await expect(post.getByRole('heading', { name: 'Hulp is onderweg' })).toBeVisible({ timeout: 10_000 });

  // With signal back, the rest of the post's data arrives too.
  await ehbo.unroute('**/api/package');
  await expect(ehbo.getByRole('link', { name: 'Bel locatie' })).toBeVisible({ timeout: 15_000 });

  expect((await post.request.post(`/api/incidents/${id}/withdraw`)).ok()).toBe(true);
});

test('choosing a route: what is not on it steps back, and choosing it again undoes that', async ({ browser }) => {
  // The post from the earlier test lies far from every route.
  const FAR = 'Waterpost 9 · nieuw';
  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Kaart' }).click();
  // Built out of sight at the same size as on screen, so it's framed right.
  await expectFullMap(coordinator);
  const faded = coordinator.locator(`.post-marker.faded[aria-label="${FAR}"]`);
  await expect(coordinator.locator('.post-marker.faded')).toHaveCount(0);

  await coordinator.getByLabel('Route').selectOption({ label: '10 km' });
  await expect(faded).toHaveCSS('pointer-events', 'none');
  await expect(faded).toHaveCSS('opacity', '0.15');

  await coordinator.getByLabel('Route').selectOption({ label: 'Alle routes' });
  await expect(coordinator.locator('.post-marker.faded')).toHaveCount(0);

  // The first screen explains the map with one entry per post type, and names no posts.
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3090', locale: 'nl-NL' });
  const page = await context.newPage();
  await page.goto('/?browser=1');
  await expect(page.locator('.legend-item').filter({ hasText: 'Water' })).toHaveCount(1);
  await expect(page.locator('.legend').getByText(FAR)).toHaveCount(0);
  await context.close();
});

test('overview map: teams in the list for all staff, counters only for the coordinator', async ({ browser }) => {
  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Kaart' }).click();
  await expect(coordinator.getByLabel(/^Locaties open:/)).toBeVisible();
  // Closed posts keep their full colour.
  await expect(coordinator.locator('.post-marker').first()).toHaveCSS('opacity', '1');
  await expect(coordinator.getByLabel(/^EHBO beschikbaar:/)).toBeVisible();
  await expect(coordinator.locator('.team-row').filter({ hasText: 'Team 2' })).toBeVisible();

  await coordinator.getByLabel('Functie').selectOption('teams');
  await expect(coordinator.locator('.post-row')).toHaveCount(0);
  await expect(coordinator.locator('.team-row')).toHaveCount(2);
  // Team 2 is on duty without a position, so it needs attention.
  await coordinator.getByLabel('Functie').selectOption({ label: 'Vraagt aandacht' });
  await expect(coordinator.locator('.team-row').filter({ hasText: 'Team 2' })).toBeVisible();
  await expect(coordinator.locator('.team-row').filter({ hasText: 'Team 1' })).toHaveCount(0);
  await coordinator.getByLabel('Functie').selectOption({ label: 'Alle' });
  // The ring shows open or closed in the list.
  await expect(coordinator.locator('.post-row').filter({ hasText: 'Kruising 4' }).locator('.status-ring')).toHaveCSS('outline-color', 'rgb(200, 38, 30)');
  await expect(coordinator.locator('.team-row').filter({ hasText: 'Team 2' }).locator('.status-ring')).toHaveCSS('outline-color', 'rgb(10, 125, 79)');

  const post = await staffPhone(browser, PHONE.postLead);
  await post.getByRole('link', { name: 'Kaart' }).click();
  await expect(post.locator('.team-row').filter({ hasText: 'Team 2' })).toBeVisible();
  await expect(post.getByLabel('Functie').getByRole('option', { name: 'Vraagt aandacht' })).toHaveCount(0);
  await expect(post.getByLabel(/^Locaties open:/)).toHaveCount(0);
});

test('EHBO starts an incident itself, also without signal, and goes straight to closing', async ({ browser }) => {
  const ehbo = await staffPhone(browser, PHONE.mobileEhbo);
  await expect(ehbo.getByRole('heading', { name: /Uit dienst|Beschikbaar/ })).toBeVisible();
  await ehbo.getByRole('button', { name: 'Beschikbaar', exact: true }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();
  await installed(ehbo);
  await ehbo.waitForFunction(() => !localStorage.getItem('ehbo.queue'));

  await ehbo.getByRole('link', { name: 'Incident starten' }).click();
  await ehbo.context().setOffline(true);
  await expect(ehbo.locator('.where')).toContainText('Kruising 4');
  await ehbo.getByRole('button', { name: 'Kramp / blessure' }).click();
  await ehbo.getByRole('button', { name: 'Incident starten' }).click();
  await expect(ehbo.getByRole('heading', { name: 'Incident afronden' })).toBeVisible();
  await ehbo.getByRole('button', { name: 'Loos alarm' }).click();
  await ehbo.getByRole('button', { name: 'Afronden & weer beschikbaar' }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();

  await ehbo.context().setOffline(false);
  await expect(ehbo.locator('.offline-pill')).toBeHidden({ timeout: 20_000 });
  await ehbo.waitForFunction(() => !localStorage.getItem('ehbo.queue'));
  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Meldingen' }).click();
  await expect(coordinator.locator('.incident').filter({ hasText: 'zelf gestart' }).filter({ hasText: 'afgerond' })).toBeVisible();
});

test('status bar: the call is one tap away on every page, for the post and the team', async ({ browser }) => {
  const ehbo = await staffPhone(browser, PHONE.mobileEhbo);
  await expect(ehbo.getByRole('heading', { name: /Uit dienst|Beschikbaar/ })).toBeVisible();
  await ehbo.getByRole('button', { name: 'Beschikbaar', exact: true }).click();
  const post = await staffPhone(browser, PHONE.postLead);
  const open = post.getByRole('button', { name: 'Locatie openen' });
  await expect(open.or(post.getByText('Wat heb je nodig?'))).toBeVisible();
  if (await open.isVisible()) await open.click();

  await post.getByRole('link', { name: /EHBO/ }).first().click();
  await post.getByRole('button', { name: 'EHBO-verzoek versturen' }).click();
  // Not on the call itself: the header is already there.
  await expect(post.getByRole('heading', { name: "We zoeken een EHBO'er" })).toBeVisible();
  await expect(post.locator('.live-bar')).toHaveCount(0);
  await post.locator('.tabbar').getByRole('link', { name: 'Contacten' }).click();
  await expect(post.locator('.live-bar.orange')).toContainText("We zoeken een EHBO'er");

  await ehbo.getByRole('button', { name: 'Accepteren & navigeren' }).click();
  await ehbo.waitForURL(/google\.com\/maps/);
  await ehbo.goBack();
  await expect(post.locator('.live-bar.green')).toContainText('Hulp is onderweg', { timeout: 10_000 });
  await ehbo.locator('.tabbar').getByRole('link', { name: 'Contacten' }).click();
  await expect(ehbo.locator('.live-bar.red')).toContainText('Onderweg · Waterpost 3');

  // The bottom button stays above the bar, and a tap goes straight back.
  await ehbo.locator('.tabbar').getByRole('link', { name: 'EHBO' }).click();
  // Contacten has a Bel 112 too: first be sure this is the EHBO screen.
  await expect(ehbo.getByRole('heading', { name: 'Bezig met een oproep' })).toBeVisible();
  const button = (await ehbo.getByRole('link', { name: 'Bel 112' }).boundingBox())!;
  const bar = (await ehbo.locator('.live-bar').boundingBox())!;
  expect(button.y + button.height).toBeLessThanOrEqual(bar.y);
  await ehbo.locator('.live-bar').click();
  await expect(ehbo.getByRole('button', { name: 'Ik ben ter plaatse' })).toBeVisible();
  await post.locator('.live-bar').click();
  await expect(post.getByRole('heading', { name: 'Hulp is onderweg' })).toBeVisible();

  await post.getByRole('button', { name: /Melding intrekken/ }).click();
  await post.getByRole('dialog').getByRole('button', { name: 'Melding intrekken' }).click();
  await post.getByRole('button', { name: 'Locatie sluiten' }).click();
  await post.getByRole('dialog').getByRole('button', { name: 'Locatie sluiten' }).click();
  await expect(post.getByText('LOCATIE IS DICHT')).toBeVisible();
  await expect(ehbo.locator('.live-bar')).toHaveCount(0);
});

test('every page keeps its own scroll position', async ({ browser }) => {
  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.setViewportSize({ width: 390, height: 420 });
  await coordinator.getByRole('link', { name: 'Contacten' }).click();
  await expect(coordinator.getByText('Noodnummers')).toBeVisible();
  await coordinator.evaluate(() => scrollTo(0, 300));
  await coordinator.getByRole('link', { name: 'Menu' }).click();
  await expect(coordinator).toHaveURL(/\/menu$/);
  await expect.poll(() => coordinator.evaluate(() => scrollY)).toBe(0);
  await coordinator.getByRole('link', { name: 'Contacten' }).click();
  await expect.poll(() => coordinator.evaluate(() => scrollY)).toBe(300);
});

test('map tab: quiet out of view, up to date the moment it opens', async ({ browser }) => {
  const post = await staffPhone(browser, PHONE.postLead);
  const open = post.getByRole('button', { name: 'Locatie openen' });
  await expect(open.or(post.getByText('Wat heb je nodig?'))).toBeVisible();
  if (await open.isVisible()) await open.click();

  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Contacten' }).click();
  await coordinator.locator('.event-map .post-marker').first().waitFor({ state: 'attached' });
  await coordinator.evaluate(() => {
    const seen = { changes: 0 };
    Object.assign(window, { seen });
    new MutationObserver((list) => { seen.changes += list.length; }).observe(document.querySelector('.event-map')!, { subtree: true, childList: true, attributes: true });
  });

  await post.getByRole('link', { name: /EHBO/ }).first().click();
  await post.getByRole('button', { name: 'EHBO-verzoek versturen' }).click();
  await expect(post.getByRole('button', { name: 'Melding intrekken' })).toBeVisible();
  await coordinator.waitForTimeout(2_000);
  await expect(coordinator.locator('.post-marker.alert')).toHaveCount(0);
  expect(await coordinator.evaluate(() => (window as unknown as { seen: { changes: number } }).seen.changes)).toBe(0);

  await coordinator.getByRole('link', { name: 'Kaart' }).click();
  await expect(coordinator.locator('.post-marker.alert')).toHaveCount(1);
  await expect(coordinator.locator('.post-marker.alert')).toHaveCSS('animation-iteration-count', 'infinite');

  // Dragged away from the route: on return the whole route is back in view.
  const allInView = () => coordinator.evaluate(() => {
    const frame = document.querySelector('.event-map')!.getBoundingClientRect();
    return [...document.querySelectorAll('.event-map .post-marker')].every((m) => {
      const r = m.getBoundingClientRect();
      return r.left >= frame.left && r.right <= frame.right && r.top >= frame.top && r.bottom <= frame.bottom;
    });
  });
  expect(await allInView()).toBe(true);
  const box = (await coordinator.locator('.event-map').boundingBox())!;
  await coordinator.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await coordinator.mouse.down();
  await coordinator.mouse.move(box.x + box.width - 5, box.y + box.height / 2, { steps: 8 });
  await coordinator.mouse.up();
  await expect.poll(allInView).toBe(false);
  await coordinator.getByRole('link', { name: 'Contacten' }).click();
  await coordinator.getByRole('link', { name: 'Kaart' }).click();
  await expect.poll(allInView).toBe(true);

  await post.getByRole('button', { name: 'Melding intrekken' }).click();
  await post.getByRole('dialog').getByRole('button', { name: 'Melding intrekken' }).click();
  await post.getByRole('button', { name: 'Locatie sluiten' }).click();
  await post.getByRole('dialog').getByRole('button', { name: 'Locatie sluiten' }).click();
  await expect(post.getByText('LOCATIE IS DICHT')).toBeVisible();
});

test('route page: details, posts in order, GPX download and the star', async ({ browser }) => {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3090', locale: 'nl-NL' });
  const page = await context.newPage();
  await page.goto('/?browser=1');
  await page.getByRole('link', { name: /^10 km/ }).click();

  await expect(page).toHaveURL(/\/route\/\d+$/);
  await expect(page.getByRole('heading', { name: '10 km', level: 1 })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Bel EHBO' })).toBeVisible();
  await expect(page.locator('.list-row').filter({ hasText: 'Kruising 4' })).toHaveCount(2);
  await expect(page.locator('.list-row').filter({ hasText: 'Waterpost 9' })).toHaveCount(0);
  await expect(page.locator('.list-row .km').first()).toHaveText('km 0,0');

  const star = page.getByRole('button', { name: 'Favoriet: 10 km' });
  await star.click();
  await expect(star).toHaveAttribute('aria-pressed', 'true');

  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'GPX downloaden' }).click();
  expect((await download).suggestedFilename()).toBe('10-km.gpx');

  await page.getByRole('button', { name: 'Terug' }).click();
  await expect(page).toHaveURL((url) => url.pathname === '/');
  await context.close();
});

test('help to where you are: from the map tab, with the position, and the reporter follows it', async ({ browser }) => {
  // About 400 m north of the start, away from every post.
  const vera = await staffPhone(browser, PHONE.postMember, { latitude: 53.1445, longitude: 5.8111 });
  await vera.getByRole('link', { name: 'Kaart' }).click();
  await expect(vera.getByRole('button', { name: 'Mijn locatie' })).toBeVisible();
  await vera.getByRole('link', { name: 'EHBO hierheen' }).click();
  await expect(vera.getByRole('heading', { name: 'EHBO hierheen' })).toBeVisible();
  await expect(vera.getByText(/^\d+ m van /)).toBeVisible({ timeout: 10_000 });
  await expect(vera.getByText(/Nauwkeurig op ± 15 m/)).toBeVisible();
  await vera.getByRole('button', { name: 'Onwel / flauw' }).click();
  await vera.getByRole('button', { name: 'EHBO-verzoek versturen' }).click();
  await expect(vera.getByRole('heading', { name: "We zoeken een EHBO'er" })).toBeVisible();

  // Clean up: the reporter can withdraw it.
  await vera.getByRole('button', { name: 'Melding intrekken' }).click();
  await vera.getByRole('dialog').getByRole('button', { name: 'Melding intrekken' }).click();
});

test('Beheer › Mensen: everyone with where they are, and what is still missing', async ({ browser }) => {
  const admin = await staffPhone(browser, PHONE.admin);
  await admin.goto('/beheer');
  await admin.getByRole('link', { name: /^Mensen/ }).click();
  const wim = admin.locator('.person').filter({ hasText: 'Wim Water' });
  await expect(wim.getByRole('link', { name: 'Waterpost 3 · brug · locatieverantwoordelijke' })).toBeVisible();
  await expect(admin.getByText('Kruising 4: nog geen locatieverantwoordelijke')).toBeVisible();
  if (process.env.SHOTS) await admin.screenshot({ path: `${process.env.SHOTS}/mensen.png`, fullPage: true });
  await wim.getByRole('link', { name: 'Waterpost 3 · brug · locatieverantwoordelijke' }).click();
  await expect(admin).toHaveURL(/\/beheer\/posten\/\d+/);
});

test('an AED on the map: for participants in the legend, and no open or closed', async ({ browser }) => {
  const admin = await staffPhone(browser, PHONE.admin);
  const { postTypes } = await (await admin.request.get('/api/admin')).json() as { postTypes: { id: number; key: string }[] };
  const state = await (await admin.request.post('/api/admin/posts', {
    data: {
      functionIds: [postTypes.find((t) => t.key === 'aed')!.id], runId: null, name: 'AED dorpshuis', lat: 53.1430, lng: 5.8150, accuracyM: null,
      address: 'Aan de gevel', accessRoute: null, timeFrom: null, timeTo: null, contacts: [],
    },
  })).json() as { posts: { id: number; name: string }[] };
  const aed = state.posts.find((p) => p.name === 'AED dorpshuis')!;

  await admin.goto(`/post/${aed.id}`);
  await expect(admin.getByRole('heading', { name: 'AED dorpshuis' })).toBeVisible();
  await expect(admin.getByText(/Locatie is (open|dicht)/)).toHaveCount(0);
  if (process.env.SHOTS) await admin.screenshot({ path: `${process.env.SHOTS}/aed-post.png` });

  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3090', locale: 'nl-NL' });
  const participant = await context.newPage();
  await participant.goto('/?browser=1');
  await expect(participant.locator('.legend-item').filter({ hasText: 'AED' })).toBeVisible();
  if (process.env.SHOTS) await participant.screenshot({ path: `${process.env.SHOTS}/aed-legend.png`, fullPage: true });
  await context.close();

  expect((await admin.request.delete(`/api/admin/posts/${aed.id}`)).ok()).toBe(true);
});

test('import and export: the export comes back unchanged, and a CSV adds what is in it', async ({ browser }) => {
  const admin = await staffPhone(browser, PHONE.admin);
  await admin.goto('/beheer');
  await admin.getByRole('link', { name: /Importeren en exporteren/ }).click();
  const download = admin.waitForEvent('download');
  await admin.getByRole('link', { name: 'Excel-bestand downloaden' }).click();
  const file = await (await download).path();

  await admin.locator('input[type=file]').setInputFiles(file);
  await expect(admin.getByText('Het bestand is hetzelfde als wat er nu staat.')).toBeVisible();

  await admin.locator('input[type=file]').setInputFiles({ name: 'noodnummers.csv', mimeType: 'text/csv', buffer: Buffer.from('Omschrijving;Nummer\r\nTandarts;0900 7654321\r\n') });
  await expect(admin.locator('.sheet').filter({ hasText: 'Noodnummers' })).toContainText('1 nieuw');
  await admin.getByRole('button', { name: 'Importeren' }).click();
  await expect(admin.getByText(/Geïmporteerd/)).toBeVisible();
  const { emergencyNumbers } = await (await admin.request.get('/api/admin')).json() as { emergencyNumbers: { label: string; number: string }[] };
  expect(emergencyNumbers.some((n) => n.label === 'Tandarts')).toBe(true);

  // Clean up: back to the numbers from before.
  await admin.request.put('/api/admin/emergency-numbers', { data: emergencyNumbers.filter((n) => n.label !== 'Tandarts') });
});

test('updating the app: a change still waiting in the old words is converted and sent', async ({ browser }) => {
  const ehbo = await staffPhone(browser, PHONE.mobileEhbo);
  const { teams } = await (await ehbo.request.get('/api/package')).json() as { teams: { id: number; name: string }[] };
  const secondTeamId = teams.find((u) => u.name === 'Team 2')!.id;
  // As the oldest version of the app left it: Dutch values, a unit instead of a team, and no storage version yet.
  await ehbo.evaluate((id) => {
    localStorage.setItem('ehbo.queue', JSON.stringify([{ id: crypto.randomUUID(), at: new Date().toISOString(), action: { type: 'availability', unitId: id, availability: 'pauze' } }]));
    localStorage.removeItem('ehbo.storage');
  }, secondTeamId);
  await ehbo.reload();
  await expect.poll(async () => {
    const state = await (await ehbo.request.get('/api/live/state')).json() as { teams: { id: number; availability: string }[] };
    return state.teams.find((u) => u.id === secondTeamId)!.availability;
  }, { timeout: 15_000 }).toBe('unavailable');
  expect((await ehbo.request.put(`/api/teams/${secondTeamId}/availability`, { data: { availability: 'off_duty' } })).ok()).toBe(true);
});
