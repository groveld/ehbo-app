<script setup lang="ts">
// Lijn-icoon; de paden staan in icons.ts.
import { PATHS, type IconName } from '../icons.ts';

export type { IconName };

withDefaults(defineProps<{ name: IconName; size?: number }>(), { size: 24 });
</script>

<template>
  <svg
    :width="size" :height="size" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" v-html="PATHS[name]"
  />
</template>
