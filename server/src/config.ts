// Instellingen uit omgevingsvariabelen, met standaardwaarden voor lokaal ontwikkelen.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const config = {
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dataDir: process.env.DATA_DIR ?? path.join(REPO_ROOT, 'data'),
  webDir: process.env.WEB_DIR ?? path.join(REPO_ROOT, 'web', 'dist'),
  vapidSubject: process.env.VAPID_SUBJECT ?? '',
  version: process.env.APP_VERSION ?? 'dev',
  commit: process.env.GIT_SHA ?? 'onbekend',
  builtAt: process.env.BUILD_DATE ?? '',
};
