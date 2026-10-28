// Instellingen uit omgevingsvariabelen, met standaardwaarden voor lokaal ontwikkelen.
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizePhone } from '@ehbo/shared';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

const adminPhone = process.env.ADMIN_PHONE ? normalizePhone(process.env.ADMIN_PHONE) : null;
if (process.env.ADMIN_PHONE && !adminPhone) throw new Error(`ADMIN_PHONE is geen geldig telefoonnummer: ${process.env.ADMIN_PHONE}`);

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? path.join(REPO_ROOT, 'data'),
  webDir: process.env.WEB_DIR ?? path.join(REPO_ROOT, 'web', 'dist'),
  /** Naam van het evenementbestand (data/events/<event>.sqlite). Later bepaalt het subdomein dit. */
  event: process.env.EVENT ?? 'silvesterloop',
  /** Eerste beheerder; wordt alleen gebruikt zolang een evenement nog geen beheerder heeft. */
  adminPhone,
  vapidSubject: process.env.VAPID_SUBJECT ?? '',
  version: process.env.APP_VERSION ?? 'dev',
  commit: process.env.GIT_SHA ?? 'onbekend',
  builtAt: process.env.BUILD_DATE ?? '',
};
