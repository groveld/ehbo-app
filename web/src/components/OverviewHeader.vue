<script setup lang="ts">
// Kop van de overzichtsschermen: evenement en titel.
import { computed } from 'vue';
import { usePackageStore } from '../stores/package.ts';

defineProps<{ title: string }>();
const pkg = usePackageStore();

const eyebrow = computed(() => {
  const event = pkg.pkg?.event;
  if (!event) return '';
  if (!event.startDate) return event.name;
  const day = new Date(`${event.startDate}T12:00:00`).toLocaleDateString('nl-NL', { day: 'numeric', month: 'long' });
  return `${event.name} · ${day}`;
});
</script>

<template>
  <header class="overview-header">
    <div class="titles">
      <span class="eyebrow">{{ eyebrow }}</span>
      <h1>{{ title }}</h1>
    </div>
  </header>
</template>

<style scoped>
.overview-header { padding: max(14px, env(safe-area-inset-top)) 0 10px; }
.eyebrow { display: block; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
h1 { font-size: 26px; font-weight: 700; line-height: 1.15; }
</style>
