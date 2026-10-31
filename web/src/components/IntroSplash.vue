<script setup lang="ts">
// Intro bij het openen zonder aanmelding: logo, naam en datum van het evenement, en het parcours dat zichzelf tekent.
// Even sfeer (zo'n 3,5 s), dan vanzelf weg (of eerder, met een tik). Uit het evenementpakket, dus ook zonder bereik.
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
/** All runs as lines in a 100 × 100 box, drawn alike so they read as one course. Longitude shrinks towards the north (cos latitude). */
const routes = computed(() => {
  const runs = (store.pkg?.runs ?? []).filter((r) => r.line && r.line.length > 1);
  const points = runs.flatMap((r) => r.line!);
  if (!points.length) return [];
  const k = Math.cos((points[0]![1] * Math.PI) / 180);
  const xs = points.map(([lng]) => lng * k);
  const ys = points.map(([, lat]) => -lat);
  const [minX, minY] = [Math.min(...xs), Math.min(...ys)];
  const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1;
  const offX = (SIZE - ((Math.max(...xs) - minX) / span) * SIZE) / 2;
  const offY = (SIZE - ((Math.max(...ys) - minY) / span) * SIZE) / 2;
  return runs.map((r) => ({
    id: r.id,
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
// Het parcours is na 1,5 s getekend; daarna blijft de intro nog 2 s staan.
onMounted(() => timers.push(setTimeout(close, 3500)));
onBeforeUnmount(() => timers.forEach(clearTimeout));
</script>

<template>
  <div class="intro" :class="{ leaving }" role="dialog" :aria-label="name || 'Intro'" @click="close">
    <!-- Fixed colours: the intro has its own look, apart from the event's theme. -->
    <svg class="art" viewBox="0 0 390 844" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <path d="M-40 560C60 470 150 520 240 450S380 300 460 340V900H-40Z" fill="#F2C230" />
      <path d="M-40 700C70 640 170 700 280 640S400 560 460 580V900H-40Z" fill="#FFD95C" />
      <path d="M250-40C230 60 300 110 360 130S430 170 460 150V-40Z" fill="#E8347F" />
      <path d="M-40 110C30 90 70 150 40 220S-20 300-40 290Z" fill="#F2C230" />
      <circle cx="330" cy="400" r="64" fill="#E8347F" />
    </svg>

    <div class="course">
      <svg v-if="routes.length" class="route" :viewBox="`-6 -6 ${SIZE + 12} ${SIZE + 12}`" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        <path v-for="r in routes" :key="r.id" :d="r.d" pathLength="1" />
      </svg>
      <Icon v-else name="runner" :size="160" />
    </div>

    <div class="content">
      <img v-if="session.event?.brand.logo" :src="session.event.brand.logo" :alt="`Logo ${name}`" class="logo-image">
      <h1 class="name">{{ name }}</h1>
      <template v-if="date || place">
        <span class="rule" />
        <span v-if="date" class="date">{{ formatDate(date) }}</span>
        <span v-if="place" class="place">{{ place }}</span>
      </template>
    </div>
  </div>
</template>

<style scoped>
.intro {
  position: fixed; inset: 0; z-index: 100; display: flex; flex-direction: column; gap: 24px; overflow: hidden;
  padding: max(48px, env(safe-area-inset-top)) 24px max(64px, env(safe-area-inset-bottom));
  background: #FF5C9E; color: var(--ink); cursor: pointer; transition: opacity .35s;
}
.intro.leaving { opacity: 0; }
.art { position: absolute; inset: 0; width: 100%; height: 100%; }
.course { position: relative; flex: 1; min-height: 0; display: flex; align-items: center; justify-content: center; }
.route { width: 100%; height: 100%; max-width: 720px; }
.route path { fill: none; stroke: currentColor; stroke-width: 1.2; stroke-linecap: round; stroke-linejoin: round; }
/* The course draws itself in just over a second. No non-scaling-stroke here: it breaks pathLength, and the lines stay in pieces. */
.route path { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 1.4s ease-in-out .1s forwards; }
.content { position: relative; flex-shrink: 0; display: flex; flex-direction: column; align-items: center; max-width: 720px; width: 100%; margin: 0 auto; text-align: center; animation: rise .6s ease-out both; }
.logo-image { max-width: 100%; max-height: 120px; margin-bottom: 16px; object-fit: contain; }
.name { font-size: clamp(28px, 8.7vw, 40px); font-weight: 700; letter-spacing: -0.02em; line-height: 1.08; text-wrap: balance; }
.rule { width: 44px; height: 4px; border-radius: 2px; background: currentColor; margin: 18px 0 16px; }
.date { font-size: 17px; font-weight: 600; line-height: 1.4; }
.date::first-letter { text-transform: uppercase; }
.place { font-size: 15px; font-weight: 500; line-height: 1.4; }
@keyframes draw { to { stroke-dashoffset: 0; } }
@keyframes rise { from { opacity: 0; transform: translateY(12px); } }
@media (prefers-reduced-motion: reduce) {
  .route path { animation: none; stroke-dashoffset: 0; }
  .content { animation: none; }
}
</style>
