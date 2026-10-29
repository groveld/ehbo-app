<script setup lang="ts">
// Kader voor de beheerschermen: kop met terugknop, gegevens laden, en een vaste knop onderaan.
import { onMounted, ref } from 'vue';
import type { RouteLocationRaw } from 'vue-router';
import { useAdminStore } from '../stores/admin.ts';
import Icon from './Icon.vue';

defineProps<{ title: string; eyebrow?: string; back: RouteLocationRaw }>();

const admin = useAdminStore();
const error = ref('');

onMounted(async () => {
  if (admin.state) return;
  try {
    await admin.load();
  } catch (err) {
    error.value = navigator.onLine ? (err as Error).message : 'Geen bereik. Beheren kan alleen met internet.';
  }
});
</script>

<template>
  <main class="screen tight">
    <header class="page-header">
      <RouterLink :to="back" aria-label="Terug" class="icon-btn"><Icon name="back" /></RouterLink>
      <div class="titles">
        <span v-if="eyebrow" class="eyebrow">{{ eyebrow }}</span>
        <h1>{{ title }}</h1>
      </div>
      <!-- Rechtsboven, bijv. "Wijzigen". -->
      <slot name="action" />
    </header>

    <p v-if="error" class="note warn" role="alert">{{ error }}</p>
    <p v-else-if="!admin.state" class="small">Laden…</p>
    <div v-else class="stack gap-14 body">
      <slot :state="admin.state" />
    </div>

    <div class="grow" />
    <div v-if="admin.state && $slots.footer" class="form-footer">
      <slot name="footer" />
    </div>
  </main>
</template>

<style scoped>
.body { padding-top: 8px; }
.titles { flex-grow: 1; min-width: 0; }
</style>
