<script setup lang="ts">
// 2.8 · Deelnemer, en het beginscherm van de app zonder aanmelding: naam van het evenement, route, starttijden met favoriete loop
// vooraan, een legenda van de soorten posten, Bel EHBO en rechtsboven Aanmelden voor medewerkers.
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref } from 'vue';
import type { EhboStatus } from '@ehbo/shared';
import { api } from '../api.ts';
import CallEhbo from '../components/CallEhbo.vue';
import Icon from '../components/Icon.vue';
import PostBadge from '../components/PostBadge.vue';
import { useFavorites } from '../composables/useFavorites.ts';
import { canUseAsStaff } from '../platform.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

// The map library is large: the screen doesn't wait for it.
const EventMap = defineAsyncComponent(() => import('../components/EventMap.vue'));

const store = usePackageStore();
const { favorites, toggleFavorite } = useFavorites();
const live = useLiveStore();
/** Standplaatsen waar de mobiele EHBO nu niet is: grijs kruisje. Zonder bereik blijft de laatste stand staan. */
const awayPostIds = ref<number[]>([]);
// Medewerkers zetten de app eerst op het beginscherm; in de browser kan aanmelden alleen met ?browser=1.
const staffRoute = canUseAsStaff ? { name: 'aanmelden' } : { name: 'installeren' };
// Elke halve minuut, zolang de pagina in beeld is; mobiele eenheden delen hun positie elke minuut.
async function refreshEhbo() {
  if (document.visibilityState !== 'visible') return;
  try {
    const status = await api<EhboStatus>('/api/ehbo-status');
    awayPostIds.value = status.awayPostIds;
    // Participants have no live connection, so changes in admin reach them this way.
    live.checkData(status.dataVersion);
  } catch {
    // Geen bereik.
  }
}
let timer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  store.refresh();
  void refreshEhbo();
  timer = setInterval(refreshEhbo, 30_000);
  document.addEventListener('visibilitychange', refreshEhbo);
});
onBeforeUnmount(() => {
  clearInterval(timer);
  document.removeEventListener('visibilitychange', refreshEhbo);
});

const runs = computed(() => {
  const all = store.pkg?.runs ?? [];
  return [...all.filter((r) => favorites.value.includes(r.id)), ...all.filter((r) => !favorites.value.includes(r.id))];
});
const day = computed(() => {
  const date = store.pkg?.runs.find((r) => r.date)?.date ?? store.pkg?.event.startDate;
  return date ? new Date(`${date}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' }) : null;
});
/** Explains the map: each post type that occurs in this event, once. The posts per run are on the route page. */
const legend = computed(() => {
  // Every function that occurs, also when it isn't a location's main one (#83).
  const used = new Set(store.pkg?.posts.flatMap((p) => p.functionIds));
  return store.pkg?.postTypes.filter((t) => used.has(t.id)) ?? [];
});
</script>

<template>
  <main class="screen tight">
    <!-- Deelnemers blijven hier; medewerkers melden zich rechtsboven aan. -->
    <header class="top">
      <h1>{{ store.pkg?.event.name }}</h1>
      <RouterLink :to="staffRoute" class="login"><Icon name="people" :size="14" />Aanmelden</RouterLink>
    </header>

    <template v-if="store.pkg">
      <div class="map">
        <EventMap :pkg="store.pkg" :away-post-ids="awayPostIds" />
      </div>

      <section v-if="runs.length" class="stack gap-8 section">
        <span class="section-label">Starttijden<template v-if="day"> · {{ day }}</template></span>
        <div class="runs">
          <div v-for="r in runs" :key="r.id" class="run" :class="{ favorite: favorites.includes(r.id) }">
            <RouterLink :to="{ name: 'route', params: { id: r.id } }" class="run-view">
              <span class="run-name">{{ r.name }}</span>
              <span class="mono time">{{ r.startTime ?? '–' }}</span>
            </RouterLink>
            <button class="run-star" :aria-label="`Favoriet: ${r.name}`" :aria-pressed="favorites.includes(r.id)" @click="toggleFavorite(r.id)">
              <Icon name="star" :size="18" class="star" />
            </button>
          </div>
        </div>
      </section>

      <section v-if="legend.length" class="stack gap-8 section">
        <span class="section-label">Legenda</span>
        <div class="list legend">
          <div v-for="type in legend" :key="type.id" class="list-row legend-item"><PostBadge :type="type" :size="32" /><span class="title-line">{{ type.name }}</span></div>
        </div>
      </section>
      <!-- What the app does with data, and the map licence (#127). -->
      <RouterLink :to="{ name: 'info' }" class="info-link"><Icon name="info" :size="18" />Info &amp; voorwaarden</RouterLink>
    </template>
    <p v-else class="note">Geen bereik. Open deze pagina één keer met internet; daarna werkt hij ook zonder.</p>

    <CallEhbo />
  </main>
</template>

<style scoped>
.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: max(18px, env(safe-area-inset-top)) 0 10px; }
h1 { font-size: 22px; font-weight: 700; line-height: 1.2; }
.login {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 10px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--card); color: var(--ink-2); font-size: 13px; font-weight: 600; text-decoration: none;
}
.map { height: clamp(200px, 35dvh, 420px); }
.section { margin-top: 16px; }
.runs { display: grid; grid-template-columns: repeat(auto-fill, minmax(112px, 1fr)); gap: 8px; }
.run { display: flex; align-items: flex-start; border-radius: 14px; border: 1px solid var(--line); background: var(--card); }
.run-view {
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 0 10px 10px;
  color: var(--ink); text-decoration: none;
}
.run-star { flex-shrink: 0; width: 44px; height: 44px; padding: 0; display: flex; align-items: center; justify-content: center; border: none; background: none; cursor: pointer; }
.run-name { font-size: 14px; font-weight: 700; }
.star { color: #9A9CA3; }
.favorite .star { color: #D9A400; fill: #F2C230; }
.time { font-size: 16px; }
/* Room at the end, so the Bel EHBO button doesn't cover the link. */
.info-link {
  align-self: flex-start; display: inline-flex; align-items: center; gap: 8px; min-height: 44px; margin: 8px 0 72px;
  color: var(--ink-2); font-size: 14px; font-weight: 600; text-decoration: none;
}
.legend-item { min-height: 52px; padding: 8px 14px; }
</style>
