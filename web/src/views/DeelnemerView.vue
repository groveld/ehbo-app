<script setup lang="ts">
// 2.8 · Deelnemer, en het beginscherm van de app zonder aanmelding: naam van het evenement, route, starttijden met favoriete loop
// vooraan, de posten langs de route, Bel EHBO en rechtsboven Aanmelden voor medewerkers.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatKm, telHref, type EhboStatus } from '@ehbo/shared';
import { api } from '../api.ts';
import EventMap from '../components/EventMap.vue';
import Icon from '../components/Icon.vue';
import PostBadge from '../components/PostBadge.vue';
import { canUseAsStaff } from '../platform.ts';
import { isOnRun } from '../posts.ts';
import { load, save } from '../storage.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const store = usePackageStore();
// Older versions stored one run instead of a list.
const favorites = ref([load<number | number[]>('ehbo.favoriteRun') ?? []].flat());
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

function toggleFavorite(id: number) {
  favorites.value = favorites.value.includes(id) ? favorites.value.filter((f) => f !== id) : [...favorites.value, id];
  save('ehbo.favoriteRun', favorites.value);
}
const toggleView = (id: number) => (viewing.value = viewing.value === id ? null : id);

const runs = computed(() => {
  const all = store.pkg?.runs ?? [];
  return [...all.filter((r) => favorites.value.includes(r.id)), ...all.filter((r) => !favorites.value.includes(r.id))];
});
const day = computed(() => {
  const date = store.pkg?.runs.find((r) => r.date)?.date ?? store.pkg?.event.startDate;
  return date ? new Date(`${date}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' }) : null;
});
/** In the order of the run on the map: a post it passes twice is listed twice. Without a run or GPX, all posts. */
const alongRoute = computed(() => {
  const pkg = store.pkg;
  if (!pkg) return [];
  const run = pkg.runs.find((r) => r.id === viewing.value && r.line);
  const rows = run
    ? pkg.posts.filter((post) => isOnRun(pkg, post, run.id)).flatMap((post) => {
      const km = post.passages.find((r) => r.runId === run.id)?.km ?? [null];
      return km.map((k) => ({ post, km: k }));
    })
    : pkg.posts.map((post) => ({ post, km: post.km }));
  return rows.sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity));
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
        <span class="section-label">Starttijden<template v-if="day"> · {{ day }}</template> · ster = favoriet vooraan</span>
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
      </section>

      <section v-if="alongRoute.length" class="stack gap-8 section">
        <span class="section-label">Langs de route</span>
        <div class="list">
          <div v-for="{ post, km } in alongRoute" :key="`${post.id}-${km}`" class="list-row">
            <span class="mono km">{{ km !== null ? `km ${formatKm(km)}` : '' }}</span>
            <PostBadge :type="store.typeById.get(post.typeId)" :size="28" />
            <span class="post-name">{{ post.name }}</span>
          </div>
        </div>
      </section>
    </template>
    <p v-else class="note">Geen bereik. Open deze pagina één keer met internet; daarna werkt hij ook zonder.</p>

    <!-- Bel EHBO als ronde knop rechtsonder: de EHBO-coördinator (of de evenementcoördinator) stuurt hulp. Zonder nummer belt hij 112. -->
    <a :href="store.pkg?.ehboPhone ? telHref(store.pkg.ehboPhone) : 'tel:112'" class="call-ehbo" :aria-label="store.pkg?.ehboPhone ? 'Bel EHBO' : 'Noodgeval: bel 112'">
      <svg width="30" height="30" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></svg>
    </a>
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
.km { width: 56px; flex-shrink: 0; font-size: 13px; color: var(--ink-2); }
.post-name { font-size: 15px; }
.list-row { gap: 12px; min-height: 48px; }
/* Ruimte onderaan, zodat de ronde knop de laatste post niet bedekt. */
.screen { padding-bottom: calc(100px + env(safe-area-inset-bottom)); }
.call-ehbo {
  position: fixed; z-index: 10; right: max(16px, calc((100% - 720px) / 2 + 16px)); bottom: max(20px, env(safe-area-inset-bottom));
  width: 64px; height: 64px; border-radius: 50%; background: var(--danger); box-shadow: 0 4px 12px rgba(0, 0, 0, .3);
  display: flex; align-items: center; justify-content: center; -webkit-touch-callout: none;
}
</style>
