<script setup lang="ts">
// Bel EHBO for participants: a floating button at the bottom right that grows to the left with its text. The EHBO coordinator (or the event coordinator) sends help; without a number it calls 112.
import { telHref } from '@ehbo/shared';
import { usePackageStore } from '../stores/package.ts';
import Icon from './Icon.vue';

const store = usePackageStore();
</script>

<template>
  <a :href="store.pkg?.ehboPhone ? telHref(store.pkg.ehboPhone) : 'tel:112'" class="call-ehbo" :aria-label="store.pkg?.ehboPhone ? 'Bel EHBO' : 'Noodgeval: bel 112'">
    <Icon name="ehbo" :size="24" />{{ store.pkg?.ehboPhone ? 'Bel EHBO' : 'Bel 112' }}
  </a>
</template>

<style scoped>
.call-ehbo {
  position: fixed; z-index: 10; right: max(16px, calc((100% - 720px) / 2 + 16px)); bottom: max(20px, env(safe-area-inset-bottom));
  height: 56px; padding: 0 18px 0 14px; border-radius: 16px; background: var(--danger); box-shadow: 0 4px 12px rgba(0, 0, 0, .3);
  display: flex; align-items: center; gap: 8px; color: #FFFFFF; font-size: 16px; font-weight: 700; white-space: nowrap; text-decoration: none; -webkit-touch-callout: none;
}
</style>
