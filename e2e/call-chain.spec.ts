// De oproepketen van begin tot eind, met twee telefoons: een post en een EHBO-eenheid (testgegevens uit server/src/demo.ts).
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

const PHONE = { admin: '0600000001', postLead: '0600000004', mobileEhbo: '0600000006', coordinator: '0600000002' } as const;

/** Nieuwe telefoon: aanmelden zoals een medewerker, tot het startscherm. */
async function staffPhone(browser: Browser, phone: string): Promise<Page> {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3090', locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
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

test('aanmelden → post open → EHBO-verzoek → oproep → accepteren → ter plaatse → afronden', async ({ browser }) => {
  const ehbo = await staffPhone(browser, PHONE.mobileEhbo);
  await expect(ehbo.getByRole('heading', { name: /Uit dienst|Beschikbaar/ })).toBeVisible();
  await ehbo.getByRole('button', { name: 'Beschikbaar', exact: true }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();

  const post = await staffPhone(browser, PHONE.postLead);
  await expect(post.getByRole('heading', { name: 'Waterpost 3 · brug' })).toBeVisible();
  await expect(post.getByText('POST IS DICHT')).toBeVisible();
  await post.getByRole('button', { name: 'Post openen' }).click();
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
  await expect(post.getByText('Mo Mobiel')).toBeVisible();

  await expect(ehbo.getByText(/Onderweg · sinds/i)).toBeVisible();
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
  await expect(ehbo.locator('.deployment').filter({ hasText: 'Waterpost 3 · brug' }).filter({ hasText: 'Onwel' }).first()).toBeVisible();

  await expect(post.getByRole('heading', { name: 'Klaar' })).toBeVisible({ timeout: 10_000 });
  await expect(post.getByText('Ter plaatse geholpen')).toBeVisible();
});

test('zonder bereik: bellen, en de melding gaat vanzelf weg zodra er weer bereik is', async ({ browser }) => {
  const post = await staffPhone(browser, PHONE.postLead);
  // Na de vorige test staat de post nog open; anders openen.
  const open = post.getByRole('button', { name: 'Post openen' });
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
  post.once('dialog', (dialog) => void dialog.accept());
  await post.getByRole('button', { name: 'Melding intrekken' }).click();
  await expect(post.getByText('Wat heb je nodig?')).toBeVisible();
  post.once('dialog', (dialog) => void dialog.accept());
  await post.getByRole('button', { name: 'Post sluiten' }).click();
  await expect(post.getByText('POST IS DICHT')).toBeVisible();
});

test('aanvraag water: post vraagt aan, coördinator pakt op en handelt af', async ({ browser }) => {
  const post = await staffPhone(browser, PHONE.postLead);
  await post.getByRole('button', { name: 'Post openen' }).click();
  await post.getByRole('button', { name: /^Water/ }).click();
  await expect(post.getByRole('heading', { name: 'Water aangevraagd' })).toBeVisible();
  await expect(post.getByText(/plek 1 in de wachtrij/)).toBeVisible();
  await post.getByRole('button', { name: 'Bijna op' }).click();
  await expect(post.getByRole('button', { name: 'Bijna op' })).toHaveAttribute('aria-pressed', 'true');

  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Meldingen' }).click();
  const card = coordinator.locator('.request').filter({ hasText: 'Waterpost 3' });
  await expect(card).toContainText('bijna op');
  await card.getByRole('button', { name: 'Oppakken' }).click();
  await expect(card).toContainText('Opgepakt door jou');
  await expect(post.getByText('Cor Coördinator regelt het.')).toBeVisible({ timeout: 10_000 });

  await card.getByRole('button', { name: 'Afgehandeld' }).click();
  await expect(post.getByRole('heading', { name: 'Water: afgehandeld' })).toBeVisible({ timeout: 10_000 });

  await post.getByRole('button', { name: 'Terug naar mijn post' }).click();
  post.once('dialog', (dialog) => void dialog.accept());
  await post.getByRole('button', { name: 'Post sluiten' }).click();
  await expect(post.getByText('POST IS DICHT')).toBeVisible();
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

  admin.once('dialog', (dialog) => void dialog.accept());
  await admin.getByRole('switch', { name: 'Testmodus' }).click();
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
  await expect(admin.getByText('Post is dicht')).toBeVisible();
  await admin.getByRole('switch', { name: 'Post open' }).click();
  await expect(admin.getByText('Post is open')).toBeVisible();
  await admin.getByRole('switch', { name: 'Post open' }).click();
  await expect(admin.getByText('Post is dicht')).toBeVisible();

  // Terug naar de standaardtekst, zodat een volgende ronde hetzelfde begint.
  await admin.goto('/beheer/info');
  admin.once('dialog', (dialog) => void dialog.accept());
  await admin.getByRole('button', { name: 'Terug naar de standaardtekst' }).click();
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
  await admin.getByRole('link', { name: /Posten/ }).first().click();
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
  const view = (name: string) => page.getByRole('button', { name: `Toon ${name} op de kaart` });

  await star(third!).click();
  await star(second!).click();
  await view(first!).click();
  await expect(view(first!)).toHaveAttribute('aria-pressed', 'true');
  await expect(star(first!)).toHaveAttribute('aria-pressed', 'false');
  await expect(star(second!)).toHaveAttribute('aria-pressed', 'true');
  await expect(star(third!)).toHaveAttribute('aria-pressed', 'true');

  await page.reload();
  await expect(star(second!)).toHaveAttribute('aria-pressed', 'true');
  await expect(star(third!)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('.run-name').first()).toHaveText(second!);
  await context.close();
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
      typeId: postTypes.find((t) => t.key === 'water')!.id, name: NEW_POST, km: 3, lat: 53.16, lng: 5.84, accuracyM: null, address: null, accessRoute: null,
      timeFrom: null, timeTo: null, contacts: [{ name: 'Nieuwe Leider', phone: '0600000011', role: 'verantwoordelijke', timeFrom: null, timeTo: null }],
    },
  });
  expect(created.ok()).toBe(true);

  // Nobody reloads: the coordinator's list shows the new post by itself.
  await expect(coordinator.locator('.post-row').filter({ hasText: NEW_POST })).toBeVisible({ timeout: 15_000 });

  const post = await staffPhone(browser, '0600000011');
  await expect(post.getByRole('heading', { name: NEW_POST })).toBeVisible();
  await post.getByRole('button', { name: 'Post openen' }).click();
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
  await expect(ehbo.getByRole('link', { name: 'Bel de post' })).toBeVisible({ timeout: 15_000 });

  expect((await post.request.post(`/api/incidents/${id}/withdraw`)).ok()).toBe(true);
});
