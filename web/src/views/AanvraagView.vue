<script setup lang="ts">
// 5.1 · Post: aanvraag verstuurd (water, verkeer, vrijwilliger). Geen spoed: de coördinator pakt hem op uit de wachtrij.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { REQUEST_KINDS, telHref } from '@ehbo/shared';
import ActivityLog from '../components/ActivityLog.vue';
import NotOnPhone from '../components/NotOnPhone.vue';
import StatusBlock from '../components/StatusBlock.vue';
import { confirmDialog } from '../composables/useDialog.ts';
import { useSave } from '../composables/useSave.ts';
import { clock, requestLog } from '../incidents.ts';
import { coordinatorOf } from '../posts.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();
const { busy, error, run } = useSave();

const request = computed(() => live.requestById(Number(props.id)));
const kind = computed(() => (request.value ? REQUEST_KINDS[request.value.kind] : null));
const open = computed(() => request.value?.status === 'aangevraagd' || request.value?.status === 'opgepakt');
const coordinator = computed(() => coordinatorOf(store.pkg));

const title = computed(() => {
  const r = request.value;
  if (!r || !kind.value) return '';
  if (r.status === 'afgehandeld') return `${kind.value.label}: afgehandeld`;
  if (r.status === 'ingetrokken') return 'Aanvraag ingetrokken';
  return `${kind.value.label} aangevraagd`;
});

const setDetail = (detail: string) => request.value && run(() => live.setRequestDetail(request.value!.id, request.value!.detail === detail ? null : detail));
async function withdraw() {
  if (!request.value || !await confirmDialog({ title: 'Aanvraag intrekken?', text: 'De coördinator hoeft er dan niets meer mee te doen.', confirm: 'Aanvraag intrekken', cancel: 'Niet intrekken', tone: 'danger' })) return;
  await run(() => live.withdrawRequest(request.value!.id));
}
const atPost = computed(() => live.myPostIds.includes(request.value?.postId ?? -1));
</script>

<template>
  <main class="screen tight">
    <NotOnPhone v-if="!request || !kind" class="top-gap">Deze aanvraag staat (nog) niet op deze telefoon.</NotOnPhone>
    <template v-else>
      <StatusBlock :tone="request.status === 'afgehandeld' ? 'green' : request.status === 'ingetrokken' ? 'dark' : 'blue'" :label="`Aanvraag · ${clock(request.createdAt)}`" :title="title" />

      <div v-if="open" class="stack gap-8 gap-top">
        <span class="section-title">{{ kind.ask }} (optioneel)</span>
        <div class="choice-grid">
          <button v-for="(label, key) in kind.details" :key="key" class="option" :aria-pressed="request.detail === key" :disabled="busy" @click="setDetail(key)">{{ label }}</button>
        </div>
      </div>

      <p v-if="request.status === 'opgepakt'" class="note info gap-top">{{ request.pickedBy?.name ?? 'De coördinator' }} regelt het.</p>
      <p v-else-if="request.position" class="note info gap-top">Plek {{ request.position }} in de wachtrij van de coördinator.</p>
      <ActivityLog :entries="requestLog(request)" />

      <p v-if="open" class="note gap-top">Geen spoed: je krijgt een melding als de coördinator het oppakt. Bij spoed: bel de coördinator.</p>

      <div class="grow" />
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div class="stack gap-8 bottom">
        <a v-if="open && coordinator" :href="telHref(coordinator.phone)" class="btn">Bel evenementcoördinator</a>
        <button class="btn primary" @click="router.back()">{{ atPost ? 'Terug naar mijn post' : 'Terug' }}</button>
        <button v-if="open" class="btn link muted" :disabled="busy" @click="withdraw">Aanvraag intrekken</button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.top-gap { margin-top: 24px; }
.gap-top { margin-top: 14px; }
.bottom { padding-top: 14px; }
.muted { color: var(--muted); }
</style>
