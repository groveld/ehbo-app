<script setup lang="ts">
// Intro bij het openen zonder aanmelding: logo, naam en datum van het evenement, en het parcours dat zichzelf tekent.
// Even sfeer, dan vanzelf weg (of eerder, met een tik). Uit het evenementpakket, dus ook zonder bereik.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { formatDate } from '../format.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';
import Icon from './Icon.vue';

const emit = defineEmits<{ done: [] }>();

const session = useSessionStore();
const store = usePackageStore();
const name = computed(() => session.event?.name ?? store.pkg?.event.name ?? '');
const date = computed(() => session.event?.startDate ?? store.pkg?.event.startDate ?? null);
const place = computed(() => store.pkg?.event.startLocation ?? null);

const SIZE = 100;
/** De lopen als lijnen in een vak van 100 × 100, de langste voorop. Lengtegraden korter naar het noorden (cos breedte). */
const routes = computed(() => {
  const runs = (store.pkg?.runs ?? []).filter((r) => r.line && r.line.length > 1)
    .sort((a, b) => (b.distanceKm ?? 0) - (a.distanceKm ?? 0));
  const points = runs.flatMap((r) => r.line!);
  if (!points.length) return [];
  const k = Math.cos((points[0]![1] * Math.PI) / 180);
  const xs = points.map(([lng]) => lng * k);
  const ys = points.map(([, lat]) => -lat);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const offX = (SIZE - ((Math.max(...xs) - minX) / span) * SIZE) / 2;
  const offY = (SIZE - ((Math.max(...ys) - minY) / span) * SIZE) / 2;
  return runs.map((r, index) => ({
    id: r.id,
    main: index === 0,
    d: r.line!.map(([lng, lat], i) => `${i ? 'L' : 'M'}${(offX + ((lng * k - minX) / span) * SIZE).toFixed(2)} ${(offY + ((-lat - minY) / span) * SIZE).toFixed(2)}`).join(''),
  }));
});

const leaving = ref(false);
let timers: ReturnType<typeof setTimeout>[] = [];
function close() {
  if (leaving.value) return;
  leaving.value = true;
  timers.push(setTimeout(() => emit('done'), 350));
}
onMounted(() => timers.push(setTimeout(close, 2200)));
onBeforeUnmount(() => timers.forEach(clearTimeout));
</script>

<template>
  <div class="intro" :class="{ leaving }" role="dialog" :aria-label="name || 'Intro'" @click="close">
    <svg v-if="routes.length" class="route" :viewBox="`-6 -6 ${SIZE + 12} ${SIZE + 12}`" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
      <path v-for="r in routes" :key="r.id" :d="r.d" pathLength="1" :class="{ main: r.main }" />
    </svg>
    <Icon v-else name="runner" :size="160" class="runner" />

    <div class="content">
      <img v-if="session.event?.brand.logo" :src="session.event.brand.logo" :alt="`Logo ${name}`" class="logo-image">
      <span v-else class="logo">{{ name }}</span>
      <span v-if="date || place" class="meta">{{ [date && formatDate(date), place].filter(Boolean).join(' · ') }}</span>
    </div>
  </div>
</template>

<style scoped>
.intro {
  position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; justify-content: flex-end; overflow: hidden;
  padding: max(24px, env(safe-area-inset-top)) 24px max(48px, env(safe-area-inset-bottom));
  background: var(--primary); color: #FFFFFF; cursor: pointer; transition: opacity .35s;
}
.intro.leaving { opacity: 0; }
.route { position: absolute; inset: 8% 8% 32%; width: 84%; height: 60%; }
.route path { fill: none; stroke: #FFFFFF; stroke-opacity: .25; stroke-width: 2.5; stroke-linecap: round; stroke-linejoin: round; vector-effect: non-scaling-stroke; }
.route path.main { stroke: var(--accent); stroke-opacity: 1; stroke-width: 4; }
/* Het parcours tekent zichzelf in ruim een seconde. */
.route path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.4s ease-in-out .1s forwards; }
.runner { position: absolute; top: 22%; left: 50%; translate: -50% 0; color: var(--accent); opacity: .9; }
.content { position: relative; display: flex; flex-direction: column; gap: 12px; max-width: 720px; width: 100%; margin: 0 auto; animation: rise .6s ease-out both; }
.logo-image { align-self: flex-start; max-width: 100%; max-height: 120px; object-fit: contain; object-position: left center; }
.logo {
  align-self: flex-start; max-width: 100%; padding: 16px 18px; border-radius: 16px; background: var(--accent); color: var(--ink);
  font-size: 28px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; text-transform: uppercase;
}
.meta { font-size: 16px; font-weight: 600; color: var(--soft-text); }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
@media (prefers-reduced-motion: reduce) {
  .route path { animation: none; stroke-dashoffset: 0; }
  .content { animation: none; }
}
</style>
