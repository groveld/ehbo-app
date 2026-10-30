<script setup lang="ts">
// The km points of a post per run, each as a small chip: commas would clash with the decimal comma.
import { formatKm, type PostPassages } from '@ehbo/shared';

defineProps<{ passages: PostPassages[]; runs: { id: number; name: string }[] }>();
</script>

<template>
  <div class="km-points">
    <div v-for="p in passages" :key="p.runId" class="run">
      <span class="run-name">{{ runs.find((r) => r.id === p.runId)?.name ?? 'Loop' }}</span>
      <span v-for="(km, n) in p.km" :key="n" class="km mono">{{ formatKm(km) }}</span>
    </div>
  </div>
</template>

<style scoped>
.km-points { display: flex; flex-direction: column; gap: 6px; }
.run { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.run-name { font-size: 14px; margin-right: 2px; }
.km { padding: 1px 8px; border-radius: 999px; background: var(--info-bg); color: var(--info); font-size: 13px; }
</style>
