// End-to-end-test van de oproepketen (aanmelden → verzoek → oproep → afronden) in Chromium.
// Eerst npm run build; de test start zelf een server met testgegevens (e2e/server.ts).
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  // Eén server met één evenement: de tests draaien na elkaar.
  workers: 1,
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['github'], ['list']] : 'list',
  use: {
    baseURL: 'http://127.0.0.1:3090',
    ...devices['Pixel 7'],
    locale: 'nl-NL',
    timezoneId: 'Europe/Amsterdam',
    trace: 'retain-on-failure',
  },
  webServer: {
    command: 'node --disable-warning=ExperimentalWarning e2e/server.ts',
    url: 'http://127.0.0.1:3090/healthz',
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
