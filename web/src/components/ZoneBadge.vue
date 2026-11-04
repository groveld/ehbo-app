<script setup lang="ts">
// A zone's kind as a rounded square with its letter (P for parking), in the fixed colour of that kind: the same as on the map.
import { ZONE_KINDS, type ZoneKind } from '@ehbo/shared';

withDefaults(defineProps<{ kind: ZoneKind; size?: number }>(), { size: 40 });
</script>

<template>
  <span class="zone-badge" aria-hidden="true" :style="{ width: `${size}px`, height: `${size}px`, background: ZONE_KINDS[kind].color, fontSize: `${Math.round(size * 0.45)}px` }">
    {{ ZONE_KINDS[kind].letter }}
  </span>
</template>

<style scoped>
.zone-badge { flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 28%; color: #FFFFFF; font-weight: 700; }
:root[data-theme="dark"] .zone-badge { box-shadow: inset 0 0 0 1.5px rgba(255, 255, 255, .28); }
</style>
