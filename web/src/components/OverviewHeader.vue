<script setup lang="ts">
// Kop van de overzichtsschermen: evenement, titel, of de app klaar is voor gebruik zonder bereik, en het menu.
import { computed, onMounted } from 'vue';
import { useLocationStore } from '../stores/location.ts';
import { usePackageStore } from '../stores/package.ts';
import Icon from './Icon.vue';

defineProps<{ title: string }>();
const pkg = usePackageStore();
const location = useLocationStore();
onMounted(() => location.check());

const eyebrow = computed(() => {
  const event = pkg.pkg?.event;
  if (!event) return '';
  if (!event.startDate) return event.name;
  const day = new Date(`${event.startDate}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
  return `${event.name} · ${day}`;
});

const status = computed(() => {
  if (pkg.mapProgress) return { text: `Kaart laden ${Math.round((pkg.mapProgress.done / pkg.mapProgress.total) * 100)}%`, tone: 'busy' };
  if (!pkg.pkg) return { text: 'Laden…', tone: 'busy' };
  if (!pkg.pkg.map) return { text: 'Nog geen kaart', tone: 'idle' };
  if (pkg.offlineReady) return { text: location.permission === 'granted' ? 'Offline klaar · GPS' : 'Offline klaar', tone: 'ok' };
  return { text: 'Kaart nog niet opgeslagen', tone: 'idle' };
});
</script>

<template>
  <header class="overview-header">
    <div class="titles">
      <span class="eyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
    </div>
    <span class="status" :class="status.tone" role="status"><span class="dot" />{{ status.text }}</span>
    <RouterLink :to="{ name: 'menu' }" class="icon-btn" aria-label="Menu"><Icon name="menu" /></RouterLink>
  </header>
</template>

<style scoped>
.overview-header { display: flex; align-items: flex-end; gap: 8px; padding: max(14px, env(safe-area-inset-top)) 0 10px; }
.titles { flex-grow: 1; min-width: 0; }
.eyebrow { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
h1 { font-size: 26px; font-weight: 700; line-height: 1.15; }
.status { display: inline-flex; align-items: center; gap: 6px; flex-shrink: 0; margin-bottom: 8px; padding: 6px 10px; border-radius: 999px; font-size: 12px; font-weight: 600; white-space: nowrap; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: currentColor; }
.status.ok { background: var(--ok-bg); color: var(--ok-text); }
.status.busy { background: var(--warn-bg); color: var(--warn); }
.status.idle { background: var(--soft); color: var(--ink-2); }
.icon-btn { margin: 0 -10px 0 -4px; }
</style>
