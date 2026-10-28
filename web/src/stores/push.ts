// Service worker, toestemming en push-abonnement van dit toestel.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AppInfo, PushSubscriptionData, TestPushResponse } from '@ehbo/shared';
import { api, ApiRequestError } from '../api.ts';

export type Permission = NotificationPermission | 'unsupported';

function b64urlToUint8(b64: string) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
}

export const usePushStore = defineStore('push', () => {
  const info = ref<AppInfo | null>(null);
  const serverState = ref<'onbekend' | 'bereikbaar' | 'niet bereikbaar'>('onbekend');
  const workerState = ref<'onbekend' | 'actief' | 'fout' | 'niet ondersteund'>('onbekend');
  const permission = ref<Permission>('default');
  const hasSubscription = ref(false);
  const serverSubscription = ref<'ja' | 'nee' | 'fout'>('nee');
  const log = ref<{ id: number; time: string; text: string }[]>([]);
  let registration: ServiceWorkerRegistration | null = null;
  let logId = 0;

  const subscribed = computed(() => hasSubscription.value && permission.value === 'granted');

  function addLog(text: string) {
    log.value.unshift({ id: ++logId, time: new Date().toLocaleTimeString('nl-NL'), text });
  }

  function registerWorker() {
    if (!('serviceWorker' in navigator)) {
      workerState.value = 'niet ondersteund';
      return;
    }
    navigator.serviceWorker.register('/sw.js', { scope: '/' }).catch((err: Error) => {
      workerState.value = 'fout';
      addLog(`Service worker registreren mislukt: ${err.message}`);
    });
    navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
      if (e.data?.type === 'push-received') addLog(`Melding ontvangen: ${e.data.title}`);
    });
  }

  async function loadInfo() {
    try {
      info.value = await api<AppInfo>('/api/info');
      serverState.value = 'bereikbaar';
    } catch (err) {
      serverState.value = 'niet bereikbaar';
      addLog(`Server: ${(err as Error).message}`);
    }
  }

  async function currentSubscription() {
    return registration ? registration.pushManager.getSubscription() : null;
  }

  async function refresh() {
    if (!('Notification' in window) || !('PushManager' in window)) {
      permission.value = 'unsupported';
      hasSubscription.value = false;
      return null;
    }
    permission.value = Notification.permission;
    const sub = await currentSubscription();
    hasSubscription.value = sub !== null;
    if (!subscribed.value) serverSubscription.value = 'nee';
    return sub;
  }

  async function registerWithServer(sub: PushSubscription) {
    await api('/api/subscriptions', { method: 'POST', body: { subscription: sub.toJSON() as PushSubscriptionData } });
    serverSubscription.value = 'ja';
  }

  /** Voor het controlescherm: wachten op de service worker en het abonnement opnieuw aan de server doorgeven. */
  async function init() {
    await loadInfo();
    if (!('serviceWorker' in navigator)) return;
    try {
      registration = await navigator.serviceWorker.ready;
      workerState.value = 'actief';
    } catch (err) {
      workerState.value = 'fout';
      addLog(`Service worker: ${(err as Error).message}`);
    }
    const sub = await refresh();
    // Voor het geval de server het abonnement niet (meer) kent.
    if (sub && subscribed.value && info.value) {
      await registerWithServer(sub).catch((err: Error) => {
        serverSubscription.value = 'fout';
        addLog(`Aanmelden bij server: ${err.message}`);
      });
    }
  }

  async function enable() {
    try {
      // Moet direct vanuit de tik gebeuren (vereist op iPhone).
      const result = await Notification.requestPermission();
      if (result !== 'granted') {
        addLog(`Toestemming: ${result}`);
        return;
      }
      if (!registration || !info.value) throw new Error('service worker of server nog niet klaar');
      const sub = (await registration.pushManager.getSubscription())
        ?? (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlToUint8(info.value.vapidPublicKey) }));
      await registerWithServer(sub);
      addLog(`Meldingen aangezet (${new URL(sub.endpoint).host})`);
    } catch (err) {
      addLog(`Aanzetten mislukt: ${(err as Error).message}`);
    } finally {
      await refresh();
    }
  }

  async function disable() {
    const sub = await currentSubscription();
    if (sub) {
      await api('/api/subscriptions', { method: 'DELETE', body: { endpoint: sub.endpoint } }).catch(() => {});
      await sub.unsubscribe();
    }
    addLog('Meldingen uitgezet');
    await refresh();
  }

  async function testPush(delaySeconds: number) {
    const sub = await currentSubscription();
    if (!sub) return;
    try {
      const r = await api<TestPushResponse>('/api/test-push', { method: 'POST', body: { endpoint: sub.endpoint, delaySeconds } });
      addLog(delaySeconds ? `Testmelding komt over ${r.scheduledInSeconds} s. Vergrendel nu je telefoon.` : 'Testmelding verstuurd');
    } catch (err) {
      const detail = err instanceof ApiRequestError && err.body.detail ? ` · ${err.body.detail}` : '';
      addLog(`Testmelding mislukt: ${(err as Error).message}${detail}`);
      if (err instanceof ApiRequestError && (err.status === 404 || err.body.gone)) {
        await sub.unsubscribe().catch(() => {});
        await refresh();
      }
    }
  }

  return {
    info, serverState, workerState, permission, subscribed, serverSubscription, log,
    addLog, registerWorker, loadInfo, init, enable, disable, testPush,
  };
});
