<script setup lang="ts">
// Bel EHBO for participants: a round button at the bottom right. The EHBO coordinator (or the event coordinator) sends help; without a number it calls 112.
import { telHref } from '@ehbo/shared';
import { usePackageStore } from '../stores/package.ts';

const store = usePackageStore();
</script>

<template>
  <a :href="store.pkg?.ehboPhone ? telHref(store.pkg.ehboPhone) : 'tel:112'" class="call-ehbo" :aria-label="store.pkg?.ehboPhone ? 'Bel EHBO' : 'Noodgeval: bel 112'">
    <svg width="30" height="30" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z" /></svg>
  </a>
</template>

<style scoped>
.call-ehbo {
  position: fixed; z-index: 10; right: max(16px, calc((100% - 720px) / 2 + 16px)); bottom: max(20px, env(safe-area-inset-bottom));
  width: 64px; height: 64px; border-radius: 50%; background: var(--danger); box-shadow: 0 4px 12px rgba(0, 0, 0, .3);
  display: flex; align-items: center; justify-content: center; -webkit-touch-callout: none;
}
</style>
