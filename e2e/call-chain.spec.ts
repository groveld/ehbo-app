// De oproepketen van begin tot eind, met twee telefoons: een post en een EHBO-eenheid (testgegevens uit server/src/demo.ts).
import { devices, expect, test, type Browser, type Page } from '@playwright/test';

const PHONE = { admin: '0600000001', postLead: '0600000004', mobileEhbo: '0600000006', coordinator: '0600000002' } as const;

/** Nieuwe telefoon: aanmelden zoals een medewerker, tot het startscherm. */
async function staffPhone(browser: Browser, phone: string, place?: RegExp): Promise<Page> {
  const context = await browser.newContext({ ...devices['Pixel 7'], baseURL: 'http://127.0.0.1:3090', locale: 'nl-NL', timezoneId: 'Europe/Amsterdam' });
  // Navigeren opent Google Maps; dat vangen we af, zodat de test bij de app blijft.
  await context.addInitScript(() => localStorage.setItem('ehbo.nav', JSON.stringify('google')));
  await context.route('https://www.google.com/**', (route) => route.fulfill({ contentType: 'text/html', body: '<title>Kaarten</title>' }));
  const page = await context.newPage();
  await page.goto('/?browser=1');
  await page.getByRole('link', { name: /Medewerker \/ vrijwilliger/ }).click();
  await page.getByLabel('Je mobiele nummer').fill(phone);
  await page.getByRole('button', { name: 'Verder' }).click();
  await expect(page.getByText('Nummer herkend')).toBeVisible();
  if (place) await page.getByRole('button', { name: place }).click();
  await page.getByRole('button', { name: 'Klopt, start' }).click();
  // Info & voorwaarden alleen de eerste keer.
  const info = page.getByRole('button', { name: 'Gelezen, verder' });
  const done = page.getByRole('link', { name: 'Klaar, naar mijn startscherm' });
  await expect(info.or(done)).toBeVisible();
  if (await info.isVisible()) await info.click();
  await done.click();
  return page;
}

test('aanmelden → post open → EHBO-verzoek → oproep → accepteren → ter plaatse → afronden', async ({ browser }) => {
  const ehbo = await staffPhone(browser, PHONE.mobileEhbo);
  await expect(ehbo.getByRole('heading', { name: /Uit dienst|Beschikbaar/ })).toBeVisible();
  await ehbo.getByRole('button', { name: 'Vrij', exact: true }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();

  const post = await staffPhone(browser, PHONE.postLead, /Waterpost 3/);
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

  await ehbo.getByRole('link', { name: 'Incident afronden' }).click();
  await ehbo.getByRole('button', { name: 'Ter plaatse geholpen' }).click();
  await ehbo.getByLabel('Korte notitie').fill('Gekoeld en drinken gegeven');
  await ehbo.getByRole('button', { name: 'Afronden & weer beschikbaar' }).click();
  await expect(ehbo.getByRole('heading', { name: 'Beschikbaar' })).toBeVisible();
  await expect(ehbo.getByText(/Waterpost 3 · brug · Onwel/).first()).toBeVisible();

  await expect(post.getByRole('heading', { name: 'Klaar' })).toBeVisible({ timeout: 10_000 });
  await expect(post.getByText('Ter plaatse geholpen')).toBeVisible();
});

test('zonder bereik: bellen, en de melding gaat vanzelf weg zodra er weer bereik is', async ({ browser }) => {
  const post = await staffPhone(browser, PHONE.postLead, /Waterpost 3/);
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
  const post = await staffPhone(browser, PHONE.postLead, /Waterpost 3/);
  await post.getByRole('button', { name: 'Post openen' }).click();
  await post.getByRole('button', { name: /^Water/ }).click();
  await expect(post.getByRole('heading', { name: 'Water aangevraagd' })).toBeVisible();
  await expect(post.getByText(/plek 1 in de wachtrij/)).toBeVisible();
  await post.getByRole('button', { name: 'Bijna op' }).click();
  await expect(post.getByRole('button', { name: 'Bijna op' })).toHaveAttribute('aria-pressed', 'true');

  const coordinator = await staffPhone(browser, PHONE.coordinator);
  await coordinator.getByRole('link', { name: 'Verzoeken' }).click();
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
