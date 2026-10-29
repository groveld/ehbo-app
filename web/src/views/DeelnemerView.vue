<script setup lang="ts">
// 2.8 · Deelnemer: route, starttijden met favoriete loop vooraan, en de posten langs de route. Zonder namen of nummers.
import { computed, onMounted, ref } from 'vue';
import { formatKm } from '@ehbo/shared';
import Call112 from '../components/Call112.vue';
import EventMap from '../components/EventMap.vue';
import Icon from '../components/Icon.vue';
import PostBadge from '../components/PostBadge.vue';
import { load, save } from '../storage.ts';
import { usePackageStore } from '../stores/package.ts';

const store = usePackageStore();
const favorite = ref<number | null>(load('ehbo.favoriteRun'));
onMounted(() => store.refresh());

function toggleFavorite(id: number) {
  favorite.value = favorite.value === id ? null : id;
  save('ehbo.favoriteRun', favorite.value);
}

const runs = computed(() => {
  const all = store.pkg?.runs ?? [];
  return [...all.filter((r) => r.id === favorite.value), ...all.filter((r) => r.id !== favorite.value)];
});
const day = computed(() => {
  const date = store.pkg?.runs.find((r) => r.date)?.date ?? store.pkg?.event.startDate;
  return date ? new Date(`${date}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' }) : null;
});
const alongRoute = computed(() => [...(store.pkg?.posts ?? [])].sort((a, b) => (a.km ?? Infinity) - (b.km ?? Infinity)));
</script>

<template>
  <main class="screen tight">
    <header class="top">
      <RouterLink :to="{ name: 'welkom' }" aria-label="Terug" class="icon-btn"><Icon name="back" /></RouterLink>
      <div>
        <span class="eyebrow">{{ store.pkg?.event.name }}</span>
        <h1>Route &amp; tijden</h1>
      </div>
    </header>

    <template v-if="store.pkg">
      <div class="map">
        <EventMap :pkg="store.pkg" :highlight-run-id="favorite" />
      </div>

      <section v-if="runs.length" class="stack gap-8 section">
        <span class="section-label">Starttijden<template v-if="day"> · {{ day }}</template> · ster = favoriet vooraan</span>
        <div class="runs">
          <button
            v-for="r in runs" :key="r.id" class="run" :class="{ favorite: favorite === r.id }"
            :aria-label="favorite === r.id ? `Favoriet: ${r.name}` : `Markeer als favoriet: ${r.name}`" :aria-pressed="favorite === r.id"
            @click="toggleFavorite(r.id)"
          >
            <span class="run-name"><Icon name="star" :size="14" class="star" />{{ r.name }}</span>
            <span class="mono time">{{ r.startTime ?? '–' }}</span>
          </button>
        </div>
      </section>

      <section v-if="alongRoute.length" class="stack gap-8 section">
        <span class="section-label">Langs de route</span>
        <div class="list">
          <div v-for="p in alongRoute" :key="p.id" class="list-row">
            <span class="mono km">{{ p.km !== null ? `km ${formatKm(p.km)}` : '' }}</span>
            <PostBadge :type="store.typeById.get(p.typeId)" :size="28" />
            <span class="post-name">{{ p.name }}</span>
          </div>
        </div>
      </section>
    </template>
    <p v-else class="note">Geen bereik. Open deze pagina één keer met internet; daarna werkt hij ook zonder.</p>

    <div class="grow" />
    <Call112 />
  </main>
</template>

<style scoped>
.top { display: flex; align-items: center; gap: 4px; padding: max(14px, env(safe-area-inset-top)) 0 8px; margin-left: -12px; }
h1 { font-size: 22px; font-weight: 700; }
.map { height: clamp(200px, 35dvh, 420px); }
.section { margin-top: 16px; }
.runs { display: grid; grid-template-columns: repeat(auto-fill, minmax(80px, 1fr)); gap: 8px; }
.run {
  display: flex; flex-direction: column; align-items: flex-start; gap: 4px; padding: 10px; border-radius: 14px;
  border: 1px solid var(--line); background: var(--card); font: inherit; color: var(--ink); cursor: pointer;
}
.run.favorite { border: 2px solid var(--ink); }
.run-name { display: flex; align-items: center; gap: 4px; font-size: 14px; font-weight: 700; }
.star { color: #9A9CA3; }
.favorite .star { color: #D9A400; fill: #F2C230; }
.time { font-size: 16px; }
.km { width: 56px; flex-shrink: 0; font-size: 13px; color: var(--ink-2); }
.post-name { font-size: 15px; }
.list-row { gap: 12px; min-height: 48px; }
</style>
