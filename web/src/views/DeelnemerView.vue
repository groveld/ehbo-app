<script setup lang="ts">
// 2.8 · Deelnemer: naam van het evenement, route, starttijden met favoriete loop vooraan, de posten langs de route en Bel EHBO.
import { computed, onMounted, ref } from 'vue';
import { formatKm, telHref } from '@ehbo/shared';
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
    <!-- Deelnemers blijven hier; Sluiten gaat naar het welkomscherm, waar je ook als medewerker kunt aanmelden. -->
    <header class="top">
      <h1>{{ store.pkg?.event.name }}</h1>
      <RouterLink :to="{ name: 'welkom' }" class="close"><Icon name="close" :size="14" />Sluiten</RouterLink>
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
    <!-- Bel EHBO: de EHBO-coördinator (of de evenementcoördinator) stuurt hulp. Zonder nummer blijft 112 staan. -->
    <a v-if="store.pkg?.ehboPhone" :href="telHref(store.pkg.ehboPhone)" class="btn danger"><Icon name="phone" :size="20" />Bel EHBO</a>
    <Call112 v-else />
  </main>
</template>

<style scoped>
.top { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: max(18px, env(safe-area-inset-top)) 0 10px; }
h1 { font-size: 22px; font-weight: 700; line-height: 1.2; }
.close {
  flex-shrink: 0; display: inline-flex; align-items: center; gap: 4px; height: 32px; padding: 0 10px; border-radius: 999px;
  border: 1px solid var(--line); background: var(--card); color: var(--ink-2); font-size: 13px; font-weight: 600; text-decoration: none;
}
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
