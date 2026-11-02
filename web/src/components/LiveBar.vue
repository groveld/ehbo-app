<script setup lang="ts">
// Sits on top of the tab bar, in reach of your thumb. The same colors as the status headers, so bar and call read as one.
import type { LiveBar } from '../composables/useLiveBar.ts';
import Icon from './Icon.vue';

defineProps<{ bar: LiveBar }>();
</script>

<template>
  <RouterLink :to="bar.to" class="live-bar" :class="bar.tone">
    <span class="dot" />
    <span class="texts"><strong>{{ bar.title }}</strong><span>{{ bar.sub }}</span></span>
    <span v-if="bar.more" class="more">+{{ bar.more }}</span>
    <Icon name="forward" :size="18" />
  </RouterLink>
</template>

<style scoped>
.live-bar {
  position: fixed; z-index: 10; left: 0; right: 0; bottom: var(--tabbar-only); height: var(--live-bar);
  display: flex; align-items: center; gap: 10px; padding: 0 max(16px, calc((100% - 720px) / 2 + 16px)); color: #FFFFFF; text-decoration: none; -webkit-touch-callout: none;
}
.red { background: var(--danger); }
.green { background: var(--ok); }
.orange { background: #FFA500; color: var(--ink); }
.dot { width: 9px; height: 9px; flex-shrink: 0; border-radius: 50%; background: currentColor; }
.texts { flex-grow: 1; min-width: 0; display: flex; flex-direction: column; font-size: 12px; line-height: 1.25; }
.texts strong { font-size: 14px; }
.texts > * { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.more { flex-shrink: 0; padding: 1px 7px; border-radius: 999px; background: rgba(0, 0, 0, .2); font: 700 12px var(--mono); }
</style>
