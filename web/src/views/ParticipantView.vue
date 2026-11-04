<script setup lang="ts">
// 2.8 · Deelnemer, en het beginscherm van de app zonder aanmelding: naam van het evenement, route, starttijden met favoriete loop
// vooraan, een legenda van de soorten posten en zones, Bel EHBO (als het evenement open is) en rechtsboven drie ronde knoppen: weergave (telefoon, licht, donker), Info en Aanmelden.
import { computed, defineAsyncComponent, onMounted } from 'vue';
import { ZONE_KIND_ORDER, ZONE_KINDS } from '@ehbo/shared';
import { APPEARANCES, appearance, setAppearance, type Appearance } from '../colorScheme.ts';
import CallFirstAid from '../components/CallFirstAid.vue';
import Icon from '../components/Icon.vue';
import LocationBadge from '../components/LocationBadge.vue';
import ZoneBadge from '../components/ZoneBadge.vue';
import { useFavorites } from '../composables/useFavorites.ts';
import { useFirstAidStatus } from '../composables/useFirstAidStatus.ts';
import { canUseAsStaff } from '../platform.ts';
import { usePackageStore } from '../stores/package.ts';

// The map library is large: the screen doesn't wait for it.
const EventMap = defineAsyncComponent(() => import('../components/EventMap.vue'));

const store = usePackageStore();
const { favorites, toggleFavorite } = useFavorites();
/** Standplaatsen waar de mobiele EHBO nu niet is: grijs kruisje. Zonder bereik blijft de laatste stand staan. */
const { awayLocationIds } = useFirstAidStatus();
// Medewerkers zetten de app eerst op het beginscherm; in de browser kan aanmelden alleen met ?browser=1.
const staffRoute = canUseAsStaff ? { name: 'login' } : { name: 'install' };
/** Same three as in the staff menu; each tap goes to the next: phone, light, dark. */
const APPEARANCE_ICON = { system: 'contrast', light: 'sun', dark: 'moon' } as const;
const label = (a: Appearance) => APPEARANCES.find((x) => x.value === a)!.label.toLowerCase();
function nextAppearance() {
  const i = APPEARANCES.findIndex((a) => a.value === appearance.value);
  setAppearance(APPEARANCES[(i + 1) % APPEARANCES.length]!.value);
}
onMounted(() => store.refresh());

const runs = computed(() => {
  const all = store.pkg?.runs ?? [];
  return [...all.filter((r) => favorites.value.includes(r.id)), ...all.filter((r) => !favorites.value.includes(r.id))];
});
const day = computed(() => {
  const date = store.pkg?.runs.find((r) => r.date)?.date ?? store.pkg?.event.startDate;
  return date ? new Date(`${date}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' }) : null;
});
/** Explains the map: each post type that occurs in this event, once. The locations per run are on the route page. */
const legend = computed(() => {
  // Every function that occurs, also when it isn't a location's main one (#83).
  const used = new Set(store.pkg?.locations.flatMap((p) => p.functionIds));
  return store.pkg?.functionTypes.filter((t) => used.has(t.id)) ?? [];
});
/** The kinds of zone on the map (#172): parking, eating and drinking. A tap on a zone says more. */
const zoneKinds = computed(() => ZONE_KIND_ORDER.filter((k) => store.pkg?.zones?.some((z) => z.kind === k)));
</script>

<template>
  <main class="screen tight">
    <!-- Deelnemers blijven hier; medewerkers melden zich rechtsboven aan. -->
    <header class="top">
      <h1>{{ store.pkg?.event.name }}</h1>
      <div class="actions">
        <!-- What the app does with data, and the map licence (#127). -->
        <!-- The icon shows the choice now: half a circle follows the phone, a sun is light, a moon dark. -->
        <button class="round" :aria-label="`Weergave: ${label(appearance)}`" @click="nextAppearance"><Icon :name="APPEARANCE_ICON[appearance]" :size="18" /></button>
        <RouterLink :to="{ name: 'info' }" class="round" aria-label="Info &amp; voorwaarden"><Icon name="info" :size="18" /></RouterLink>
        <RouterLink :to="staffRoute" class="round" aria-label="Aanmelden"><Icon name="account" :size="18" /></RouterLink>
      </div>
    </header>

    <template v-if="store.pkg">
      <div class="map">
        <EventMap :pkg="store.pkg" :away-location-ids="awayLocationIds" />
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

      <section v-if="legend.length || zoneKinds.length" class="stack gap-8 section">
        <span class="section-label">Legenda</span>
        <div class="list legend">
          <div v-for="type in legend" :key="type.id" class="list-row legend-item"><LocationBadge :type="type" :size="32" /><span class="title-line">{{ type.name }}</span></div>
          <div v-for="k in zoneKinds" :key="k" class="list-row legend-item"><ZoneBadge :kind="k" :size="32" /><span class="title-line">{{ ZONE_KINDS[k].label }}</span></div>
        </div>
      </section>
    </template>
    <p v-else class="note">Geen bereik. Open deze pagina één keer met internet; daarna werkt hij ook zonder.</p>

    <CallFirstAid />
  </main>
</template>

<style scoped>
.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: max(18px, env(safe-area-inset-top)) 0 10px; }
h1 { font-size: 22px; font-weight: 700; line-height: 1.2; }
.actions { flex-shrink: 0; display: flex; align-items: center; gap: 8px; }
.round {
  display: inline-flex; align-items: center; justify-content: center; width: 36px; height: 36px; padding: 0; border-radius: 50%;
  border: 1px solid var(--line); background: var(--card); color: var(--ink-2); text-decoration: none; cursor: pointer;
}
.map { height: clamp(200px, 35dvh, 420px); }
.section { margin-top: 16px; }
.runs { display: grid; grid-template-columns: repeat(auto-fill, minmax(132px, 1fr)); gap: 8px; }
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
.legend-item { min-height: 52px; padding: 8px 14px; }
</style>
