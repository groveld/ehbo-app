<script setup lang="ts">
import { computed, defineAsyncComponent, onMounted, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { startAlarm, stopAlarm, unlockAudio } from './alarm.ts';
import { useLiveStore } from './stores/live.ts';
import { usePackageStore } from './stores/package.ts';
import { usePushStore } from './stores/push.ts';
import { useSessionStore } from './stores/session.ts';
import AppDialog from './components/AppDialog.vue';
import IntroSplash from './components/IntroSplash.vue';
import OfflinePill from './components/OfflinePill.vue';
import TabBar from './components/TabBar.vue';
import { applyTheme } from './theme.ts';

const KaartView = defineAsyncComponent(() => import('./views/overzicht/KaartView.vue'));

const push = usePushStore();
const pkg = usePackageStore();
const session = useSessionStore();
const live = useLiveStore();
const route = useRoute();
const router = useRouter();

// Eén tabbalk op elke pagina van een aangemelde medewerker. Niet tijdens het aanmelden (tot "Klaar, naar mijn startscherm")
// en niet op de afdrukpagina van het rapport.
const NO_TABS = ['herkend', 'toestemmingen', 'beheer-rapport-afdrukken'];
const tabs = computed(() => Boolean(session.me) && (route.meta.staff || route.name === 'info' || route.name === 'route') && !NO_TABS.includes(String(route.name)));

// The map tab is built once, in the background, and stays in memory: going to it is instant. Out of view it does nothing and is brought up to date when it's opened. Just after the first screen, so that comes first.
const MAP_DELAY_MS = 500;
const mapMounted = ref(false);
watch(() => Boolean(session.me), (staff) => {
  if (!staff) mapMounted.value = false;
  else setTimeout(() => { mapMounted.value = Boolean(session.me); }, route.name === 'kaart' ? 0 : MAP_DELAY_MS);
}, { immediate: true });

// Intro bij elk openen zonder aanmelding (deelnemers, en medewerkers voor het aanmelden); niet als je al aangemeld bent.
const intro = ref(!session.me);

// Kleuren en naam van het evenement; zonder bereik uit de bewaarde gegevens.
watch(() => session.event, applyTheme, { immediate: true });

// Sessie verlopen of nummer niet meer ingepland: terug naar het begin.
watch(() => session.me, (me) => {
  if (!me && route.meta.staff) router.replace({ name: 'deelnemer' });
});

// Nieuwe oproep voor mijn eenheid terwijl de app open is: meteen naar het oproepscherm.
// Niet midden in het afronden van een andere oproep; daar staat de oproep wel op het EHBO-scherm.
const seen = new Set<number>(live.invitations.map((i) => i.id));
watch(() => live.invitations.map((i) => i.id), (ids) => {
  const fresh = ids.find((id) => !seen.has(id));
  for (const id of ids) seen.add(id);
  if (fresh === undefined || route.name === 'afronden') return;
  if (!(route.name === 'oproep' && route.params.id === String(fresh))) router.push({ name: 'oproep', params: { id: fresh } });
});

// Zolang een oproep op reactie wacht: geluid en trillen, tot accepteren of "kan niet". Op de achtergrond doet de pushmelding dat.
const visible = ref(document.visibilityState === 'visible');
document.addEventListener('visibilitychange', () => (visible.value = document.visibilityState === 'visible'));
document.addEventListener('pointerdown', unlockAudio);
watch(() => live.invitations.length > 0 && visible.value, (ringing) => (ringing ? startAlarm() : stopAlarm()), { immediate: true });

onMounted(() => {
  push.registerWorker();
  // Tik op een pushmelding terwijl de app al open is: direct naar die oproep, melding of aanvraag.
  navigator.serviceWorker?.addEventListener('message', (e: MessageEvent) => {
    if (e.data?.type === 'open' && typeof e.data.url === 'string' && e.data.url !== route.fullPath) void router.push(e.data.url);
  });
  session.loadEvent();
  if (session.me) session.refresh();
  // Vaste gegevens en kaart bijwerken bij openen, bij terugkeren naar de app, en elke vijf minuten.
  void pkg.refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pkg.refresh();
  });
  setInterval(() => void pkg.refresh(), 5 * 60 * 1000);
});
</script>

<template>
  <!-- Testmodus: op elk scherm zichtbaar, zodat niemand een proefoproep voor echt aanziet. Niet op de afdrukpagina. -->
  <div v-if="live.state?.testMode && route.name !== 'beheer-rapport-afdrukken'" class="test-banner" role="status">Testmodus · oproepen zijn proef</div>
  <div :class="{ 'with-tabs': tabs }">
    <RouterView />
    <KaartView v-if="mapMounted" :active="route.name === 'kaart'" :class="{ 'map-waiting': route.name !== 'kaart' }" />
    <OfflinePill v-if="route.name !== 'beheer-rapport-afdrukken'" :tabs="tabs" />
  </div>
  <TabBar v-if="tabs" />
  <IntroSplash v-if="intro" @done="intro = false" />
  <AppDialog />
</template>

<style scoped>
/* Full size but out of sight, so the map is framed right and ready for the tab. No fixed height: that would squeeze the map, and it would frame the route for the wrong size. */
.map-waiting { position: fixed; top: 0; left: 0; right: 0; visibility: hidden; pointer-events: none; }
.test-banner {
  position: sticky; top: 0; z-index: 50; padding: max(4px, env(safe-area-inset-top)) 12px 4px;
  background: var(--warn-line); color: var(--ink); font-size: 12px; font-weight: 700; text-align: center; letter-spacing: .02em;
}
</style>
