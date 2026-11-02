<script setup lang="ts">
// Offline, on every screen in the same place: between the bottom button and the tab bar, or at the bottom left without one. Online says nothing; that's what you expect.
// Bottom left because the participant page has Bel EHBO at the bottom right. Only a sign: working offline is normal, so there's nothing to tap or count.
import { useLiveStore } from '../stores/live.ts';

defineProps<{ tabs: boolean }>();
const live = useLiveStore();
</script>

<template>
  <span v-if="live.offline" class="offline-pill" :class="{ tabs }" role="status"><span class="dot" />Offline</span>
</template>

<style scoped>
.offline-pill {
  position: fixed; z-index: 20; left: 16px; bottom: max(20px, env(safe-area-inset-bottom));
  height: 30px; padding: 0 14px; border-radius: 999px; background: var(--off); color: #FFFFFF;
  display: flex; align-items: center; gap: 6px; font: 700 14px var(--sans); box-shadow: 0 2px 8px rgba(0, 0, 0, .3); pointer-events: none;
}
/* Centered on the 16 px every screen keeps free between its bottom button and the tab bar: 8 px up, minus half of its own height. */
.offline-pill.tabs { left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar, 0px) + 8px - 15px); }
.dot { width: 9px; height: 9px; border-radius: 50%; background: var(--danger); }
</style>
