<script setup lang="ts">
// Kaart ophalen: de server haalt het gebied rond parcours en posten op uit Protomaps; telefoons slaan het daarna op.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import type { MapStatus } from '@ehbo/shared';
import { api } from '../../api.ts';
import { useAdminStore } from '../../stores/admin.ts';
import { usePackageStore } from '../../stores/package.ts';

const admin = useAdminStore();
const pkg = usePackageStore();
const status = ref<MapStatus | null>(null);
const error = ref('');
let timer: ReturnType<typeof setTimeout> | null = null;

async function poll() {
  try {
    status.value = await api<MapStatus>('/api/admin/map');
    if (status.value.state === 'running') timer = setTimeout(poll, 1500);
    else if (status.value.state === 'done') void pkg.refresh();
  } catch (err) {
    error.value = (err as Error).message;
  }
}

async function start() {
  error.value = '';
  try {
    status.value = await api<MapStatus>('/api/admin/map', { method: 'POST' });
    timer = setTimeout(poll, 1000);
  } catch (err) {
    error.value = (err as Error).message;
  }
}

onMounted(poll);
onBeforeUnmount(() => timer && clearTimeout(timer));

const current = computed(() => status.value?.current ?? null);
const built = computed(() => (current.value ? `${current.value.build.slice(6, 8)}-${current.value.build.slice(4, 6)}-${current.value.build.slice(0, 4)}` : ''));
const percent = computed(() => (status.value && status.value.total ? Math.round((status.value.done / status.value.total) * 100) : 0));

/** Posten buiten het opgehaalde gebied: dan moet de kaart opnieuw. */
const outside = computed(() => {
  if (!current.value || !admin.state) return [];
  const [w, s, e, n] = current.value.bbox;
  return admin.state.posts.filter((p) => p.lat !== null && p.lng !== null && (p.lng < w || p.lng > e || p.lat < s || p.lat > n));
});
</script>

<template>
  <section class="stack gap-8">
    <span class="section-label">Kaart</span>
    <div class="card stack gap-8">
      <template v-if="current">
        <span><strong>Kaart van {{ built }}</strong></span>
        <span class="small">{{ current.tiles }} tegels · {{ (current.bytes / 1024 / 1024).toLocaleString('nl-NL', { maximumFractionDigits: 1 }) }} MB · opgehaald {{ new Date(current.preparedAt).toLocaleString('nl-NL', { dateStyle: 'short', timeStyle: 'short' }) }}</span>
      </template>
      <span v-else class="small">Nog geen kaart. De kaart beslaat het gebied rond alle lopen (GPX) en posten, met 2 km marge.</span>

      <p v-if="outside.length" class="note warn">{{ outside.map((p) => p.name).join(', ') }} {{ outside.length === 1 ? 'ligt' : 'liggen' }} buiten de kaart. Haal de kaart opnieuw op.</p>

      <div v-if="status?.state === 'running'" class="stack gap-6" role="status">
        <div class="bar"><div class="fill" :style="{ width: `${percent}%` }" /></div>
        <span class="small">Kaart ophalen… {{ status.done }} van {{ status.total || '…' }}</span>
      </div>
      <p v-else-if="status?.state === 'error'" class="error-text" role="alert">{{ status.message }}</p>
      <p v-else-if="status?.state === 'done'" class="small" role="status">{{ status.message }}. Telefoons slaan de nieuwe kaart vanzelf op.</p>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>

      <button class="btn" :disabled="status?.state === 'running'" @click="start">{{ current ? 'Kaart bijwerken' : 'Kaart ophalen' }}</button>
    </div>
  </section>
</template>

<style scoped>
.bar { height: 8px; border-radius: 999px; background: var(--soft); overflow: hidden; }
.fill { height: 100%; background: var(--ok); transition: width .3s; }
</style>
