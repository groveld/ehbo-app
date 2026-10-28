// Testversie: installatie, service worker en pushmeldingen controleren.
const $ = (id) => document.getElementById(id);
const ua = navigator.userAgent;
const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
const isAndroid = /Android/.test(ua);
const iosVersion = (() => { const m = /OS (\d+)_(\d+)/.exec(ua); return m ? { major: Number(m[1]), minor: Number(m[2]) } : null; })();
const iosTooOld = iosVersion && (iosVersion.major < 16 || (iosVersion.major === 16 && iosVersion.minor < 4));
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
const browserTest = new URLSearchParams(location.search).has('browser');

let info = null;
let registration = null;

function log(msg) {
  const li = document.createElement('li');
  li.textContent = `${new Date().toLocaleTimeString('nl-NL')} · ${msg}`;
  $('log').prepend(li);
}
function setStatus(id, text, cls) { const el = $(id); el.textContent = text; el.className = cls ?? ''; }

function b64urlToUint8(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

async function api(path, options = {}) {
  const res = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body.error ?? `HTTP ${res.status}`), { status: res.status, body });
  return body;
}

// ---------- Installatiescherm ----------
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredPrompt = e;
  $('install-btn').hidden = false;
  $('install-android-manual').hidden = true;
});
window.addEventListener('appinstalled', () => log('App geïnstalleerd. Open hem nu vanaf je beginscherm.'));

function showInstall() {
  $('install').hidden = false;
  $('device').textContent = isIOS ? `iPhone/iPad${iosVersion ? ` · iOS ${iosVersion.major}.${iosVersion.minor}` : ''}` : isAndroid ? 'Android' : 'Computer';
  if (isIOS) {
    $('install-ios').hidden = false;
    if (iosTooOld) $('ios-old').hidden = false;
  } else if (isAndroid) {
    $('install-android').hidden = false;
  } else {
    $('install-desktop').hidden = false;
  }
  $('install-btn').addEventListener('click', async () => {
    if (!deferredPrompt) return;
    deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    deferredPrompt = null;
    if (outcome === 'accepted') $('install-btn').hidden = true;
  });
}

// ---------- App ----------
async function currentSubscription() {
  return registration ? registration.pushManager.getSubscription() : null;
}

async function refreshPermission() {
  if (!('Notification' in window) || !('PushManager' in window)) {
    setStatus('st-perm', 'niet ondersteund', 'bad');
    $('perm-help').textContent = isIOS ? 'Open de app vanaf je beginscherm (iOS 16.4 of nieuwer).' : 'Deze browser ondersteunt geen pushmeldingen.';
    $('enable-btn').disabled = true;
    return;
  }
  const p = Notification.permission;
  setStatus('st-perm', p === 'granted' ? 'toegestaan' : p === 'denied' ? 'geweigerd' : 'nog niet gevraagd', p === 'granted' ? 'ok' : p === 'denied' ? 'bad' : 'pending');
  if (p === 'denied') {
    $('perm-help').textContent = isIOS
      ? 'Meldingen zijn geweigerd. Zet ze aan via Instellingen › Meldingen › EHBO-app.'
      : 'Meldingen zijn geweigerd. Zet ze aan via de app-instellingen van je telefoon (Meldingen).';
  }
  const sub = await currentSubscription();
  const subscribed = Boolean(sub) && p === 'granted';
  $('enable-btn').hidden = subscribed;
  $('disable-btn').hidden = !subscribed;
  $('test-now').disabled = !subscribed;
  $('test-later').disabled = !subscribed;
  if (!subscribed) setStatus('st-sub', 'nee', 'pending');
  return sub;
}

async function registerWithServer(sub) {
  await api('/api/subscriptions', { method: 'POST', body: JSON.stringify({ subscription: sub.toJSON() }) });
  setStatus('st-sub', 'ja', 'ok');
}

async function enableNotifications() {
  try {
    // Moet direct vanuit de tik gebeuren (vereist op iPhone).
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') { log(`Toestemming: ${permission}`); await refreshPermission(); return; }
    let sub = await registration.pushManager.getSubscription();
    if (!sub) {
      sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToUint8(info.vapidPublicKey) });
    }
    await registerWithServer(sub);
    log(`Meldingen aangezet (${new URL(sub.endpoint).host})`);
  } catch (err) {
    log(`Aanzetten mislukt: ${err.message}`);
  }
  await refreshPermission();
}

async function disableNotifications() {
  const sub = await currentSubscription();
  if (sub) {
    await api('/api/subscriptions', { method: 'DELETE', body: JSON.stringify({ endpoint: sub.endpoint }) }).catch(() => {});
    await sub.unsubscribe();
  }
  log('Meldingen uitgezet');
  await refreshPermission();
}

async function testPush(delaySeconds) {
  const sub = await currentSubscription();
  if (!sub) return;
  try {
    const r = await api('/api/test-push', { method: 'POST', body: JSON.stringify({ endpoint: sub.endpoint, delaySeconds }) });
    log(delaySeconds ? `Testmelding komt over ${r.scheduledInSeconds} s. Vergrendel nu je telefoon.` : 'Testmelding verstuurd');
  } catch (err) {
    log(`Testmelding mislukt: ${err.message}${err.body?.detail ? ' · ' + err.body.detail : ''}`);
    if (err.status === 404 || err.body?.gone) { await sub.unsubscribe().catch(() => {}); await refreshPermission(); }
  }
}

async function showApp() {
  $('app').hidden = false;
  setStatus('st-installed', isStandalone ? 'ja' : 'nee (testmodus)', isStandalone ? 'ok' : 'pending');

  try {
    info = await api('/api/info');
    setStatus('st-server', `bereikbaar · ${info.version}`, 'ok');
  } catch (err) {
    setStatus('st-server', 'niet bereikbaar', 'bad');
    log(`Server: ${err.message}`);
  }

  if (!('serviceWorker' in navigator)) { setStatus('st-sw', 'niet ondersteund', 'bad'); return; }
  try {
    registration = await navigator.serviceWorker.ready;
    setStatus('st-sw', 'actief', 'ok');
  } catch (err) {
    setStatus('st-sw', 'fout', 'bad');
    log(`Service worker: ${err.message}`);
  }

  const sub = await refreshPermission();
  // Abonnement opnieuw doorgeven, voor het geval de server het niet (meer) kent.
  if (sub && Notification.permission === 'granted' && info) {
    registerWithServer(sub).catch((err) => { setStatus('st-sub', 'fout', 'bad'); log(`Aanmelden bij server: ${err.message}`); });
  }

  $('enable-btn').addEventListener('click', enableNotifications);
  $('disable-btn').addEventListener('click', disableNotifications);
  $('test-now').addEventListener('click', () => testPush(0));
  $('test-later').addEventListener('click', () => testPush(10));
  navigator.serviceWorker.addEventListener('message', (e) => { if (e.data?.type === 'push-received') log(`Melding ontvangen: ${e.data.title}`); });
}

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err) => log(`Service worker registreren mislukt: ${err.message}`));
}

if (isStandalone || browserTest) showApp(); else showInstall();
