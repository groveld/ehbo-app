<script setup lang="ts">
// Bel EHBO for participants: a floating button at the bottom right that grows to the left with its text. The EHBO coordinator (or the event coordinator) sends help; without a number there is no button (participants never get 112 here).
// Only while the coordinator it calls is logged in (`open` in /api/first-aid-status): before and after, nobody answers that number.
import { telHref } from '@ehbo/shared';
import { useFirstAidStatus } from '../composables/useFirstAidStatus.ts';
import { usePackageStore } from '../stores/package.ts';
import Icon from './Icon.vue';

const store = usePackageStore();
const { open } = useFirstAidStatus();
</script>

<template>
  <a v-if="open && store.pkg?.ehboPhone" :href="telHref(store.pkg.ehboPhone)" class="call-ehbo" aria-label="Bel EHBO">
    <Icon name="ehbo" :size="24" />Bel EHBO
  </a>
</template>

<style scoped>
.call-ehbo {
  position: fixed; z-index: 10; right: max(16px, calc((100% - 720px) / 2 + 16px)); bottom: max(20px, env(safe-area-inset-bottom));
  height: 56px; padding: 0 18px 0 14px; border-radius: 16px; background: var(--danger); box-shadow: 0 4px 12px rgba(0, 0, 0, .3);
  display: flex; align-items: center; gap: 8px; color: #FFFFFF; font-size: 16px; font-weight: 700; white-space: nowrap; text-decoration: none; -webkit-touch-callout: none;
}
</style>
