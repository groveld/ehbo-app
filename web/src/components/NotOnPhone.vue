<script setup lang="ts">
// Something isn't on this phone (yet). Usually that lasts a moment: the live store fetches the new data by itself.
import { useLiveStore } from '../stores/live.ts';

const live = useLiveStore();
</script>

<template>
  <p class="note warn">
    <template v-if="live.syncing">Gegevens bijwerken…</template>
    <template v-else><slot /> <button class="add-link" @click="live.reload()">Opnieuw laden</button></template>
  </p>
</template>
