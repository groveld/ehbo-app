<script setup lang="ts">
// 2.8 · Deelnemer, en het beginscherm van de app zonder aanmelding: naam van het evenement, route, starttijden met favoriete loop
// vooraan, de posten langs de route, Bel EHBO en rechtsboven Aanmelden voor medewerkers.
import { computed, onMounted, ref } from 'vue';
import { formatKm, telHref } from '@ehbo/shared';
import EventMap from '../components/EventMap.vue';
import Icon from '../components/Icon.vue';
import PostBadge from '../components/PostBadge.vue';
import { canUseAsStaff } from '../platform.ts';
import { load, save } from '../storage.ts';
import { usePackageStore } from '../stores/package.ts';

const store = usePackageStore();
const favorite = ref<number | null>(load('ehbo.favoriteRun'));
// Medewerkers zetten de app eerst op het beginscherm; in de browser kan aanmelden alleen met ?browser=1.
const staffRoute = canUseAsStaff ? { name: 'aanmelden' } : { name: 'installeren' };
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
    <!-- Deelnemers blijven hier; medewerkers melden zich rechtsboven aan. -->
    <header class="top">
      <h1>{{ store.pkg?.event.name }}</h1>
      <RouterLink :to="staffRoute" class="login"><Icon name="people" :size="14" />Aanmelden</RouterLink>
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
/* Ruimte onderaan, zodat de ronde knop de laatste post niet bedekt. */
.screen { padding-bottom: calc(100px + env(safe-area-inset-bottom)); }
.call-ehbo {
  position: fixed; z-index: 10; right: max(16px, calc((100% - 720px) / 2 + 16px)); bottom: max(20px, env(safe-area-inset-bottom));
  width: 64px; height: 64px; border-radius: 50%; background: var(--danger); box-shadow: 0 4px 12px rgba(0, 0, 0, .3);
  display: flex; align-items: center; justify-content: center; -webkit-touch-callout: none;
}
</style>
