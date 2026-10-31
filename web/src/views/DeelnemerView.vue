<script setup lang="ts">
// 2.8 · Deelnemer, en het beginscherm van de app zonder aanmelding: naam van het evenement, route, starttijden met favoriete loop
// vooraan, een legenda van de soorten posten, Bel EHBO en rechtsboven Aanmelden voor medewerkers.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { EhboStatus } from '@ehbo/shared';
import { api } from '../api.ts';
import CallEhbo from '../components/CallEhbo.vue';
import EventMap from '../components/EventMap.vue';
import Icon from '../components/Icon.vue';
import PostBadge from '../components/PostBadge.vue';
import { useFavorites } from '../composables/useFavorites.ts';
import { canUseAsStaff } from '../platform.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const store = usePackageStore();
const { favorites, toggleFavorite } = useFavorites();
/** The run shown on the map. Separate from the favorites: looking at a run changes nothing. */
const viewing = ref<number | null>(favorites.value[0] ?? null);
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

const toggleView = (id: number) => (viewing.value = viewing.value === id ? null : id);
const viewedRun = computed(() => store.pkg?.runs.find((r) => r.id === viewing.value) ?? null);

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
  const used = new Set(store.pkg?.posts.map((p) => p.typeId));
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
        <EventMap :pkg="store.pkg" :highlight-run-id="viewing" :away-post-ids="awayPostIds" />
      </div>

      <section v-if="runs.length" class="stack gap-8 section">
        <span class="section-label">Starttijden<template v-if="day"> · {{ day }}</template></span>
        <div class="runs">
          <div v-for="r in runs" :key="r.id" class="run" :class="{ viewing: viewing === r.id, favorite: favorites.includes(r.id) }">
            <button class="run-view" :aria-label="`Toon ${r.name} op de kaart`" :aria-pressed="viewing === r.id" @click="toggleView(r.id)">
              <span class="run-name">{{ r.name }}</span>
              <span class="mono time">{{ r.startTime ?? '–' }}</span>
            </button>
            <button class="run-star" :aria-label="`Favoriet: ${r.name}`" :aria-pressed="favorites.includes(r.id)" @click="toggleFavorite(r.id)">
              <Icon name="star" :size="18" class="star" />
            </button>
          </div>
        </div>
        <RouterLink v-if="viewedRun" :to="{ name: 'route', params: { id: viewedRun.id } }" class="btn route-link">Alles over {{ viewedRun.name }}</RouterLink>
      </section>

      <section v-if="legend.length" class="stack gap-8 section">
        <span class="section-label">Soorten posten</span>
        <div class="legend">
          <span v-for="type in legend" :key="type.id" class="legend-item"><PostBadge :type="type" :size="28" />{{ type.name }}</span>
        </div>
      </section>

      <RouterLink :to="{ name: 'info' }" class="add-link info-link">Info &amp; voorwaarden</RouterLink>
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
.run.viewing { box-shadow: inset 0 0 0 1px var(--ink); border-color: var(--ink); }
.run-view {
  flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px 0 10px 10px;
  border: none; background: none; font: inherit; color: var(--ink); text-align: left; cursor: pointer;
}
.run-star { flex-shrink: 0; width: 44px; height: 44px; padding: 0; display: flex; align-items: center; justify-content: center; border: none; background: none; cursor: pointer; }
.run-name { font-size: 14px; font-weight: 700; }
.star { color: #9A9CA3; }
.favorite .star { color: #D9A400; fill: #F2C230; }
.time { font-size: 16px; }
.legend { display: grid; grid-template-columns: repeat(auto-fill, minmax(136px, 1fr)); gap: 8px 12px; }
.legend-item { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 14px; }
.route-link { margin-top: 8px; }
.info-link { align-self: flex-start; margin-top: 12px; }
</style>
