<script setup lang="ts">
// 5.1 · Post: aanvraag verstuurd (water, verkeer, vrijwilliger). Geen spoed: de coördinator pakt hem op uit de wachtrij.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { REQUEST_KINDS, telHref } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import NotOnPhone from '../components/NotOnPhone.vue';
import StatusBlock from '../components/StatusBlock.vue';
import { useSave } from '../composables/useSave.ts';
import { clock } from '../incidents.ts';
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
const sub = computed(() => {
  const r = request.value;
  if (r?.status === 'opgepakt') return `${r.pickedBy?.name ?? 'De coördinator'} regelt het.`;
  if (r?.status === 'aangevraagd') return 'Staat bij de coördinator in de wachtrij.';
  return undefined;
});

const setDetail = (detail: string) => request.value && run(() => live.setRequestDetail(request.value!.id, request.value!.detail === detail ? null : detail));
async function withdraw() {
  if (!request.value || !confirm('Aanvraag intrekken?')) return;
  await run(() => live.withdrawRequest(request.value!.id));
}
const toPost = () => (request.value ? router.replace({ name: 'post-home', params: { id: request.value.postId } }) : router.back());
</script>

<template>
  <main class="screen tight">
    <NotOnPhone v-if="!request || !kind" class="top-gap">Deze aanvraag staat (nog) niet op deze telefoon.</NotOnPhone>
    <template v-else>
      <StatusBlock :tone="request.status === 'afgehandeld' ? 'green' : request.status === 'ingetrokken' ? 'dark' : 'blue'" :label="`Aanvraag · ${clock(request.createdAt)}`" :title="title" :sub="sub" />

      <div v-if="open" class="stack gap-8 gap-top">
        <span class="section-title">{{ kind.ask }} (optioneel)</span>
        <div class="choice-grid">
          <button v-for="(label, key) in kind.details" :key="key" class="option" :aria-pressed="request.detail === key" :disabled="busy" @click="setDetail(key)">{{ label }}</button>
        </div>
      </div>

      <div class="card steps">
        <div class="step"><span class="mark done"><Icon name="check" :size="14" /></span><span>Ontvangen<template v-if="request.position"> · plek {{ request.position }} in de wachtrij</template></span></div>
        <div class="step" :class="{ later: !request.pickedAt }">
          <span class="mark" :class="{ done: request.pickedAt }"><Icon v-if="request.pickedAt" name="check" :size="14" /></span>
          <span>Wordt geregeld<template v-if="request.pickedAt"> · {{ clock(request.pickedAt) }}</template></span>
        </div>
        <div class="step" :class="{ later: request.status !== 'afgehandeld' }">
          <span class="mark" :class="{ done: request.status === 'afgehandeld' }"><Icon v-if="request.status === 'afgehandeld'" name="check" :size="14" /></span>
          <span>Afgehandeld<template v-if="request.status === 'afgehandeld'"> · {{ clock(request.doneAt) }}</template></span>
        </div>
      </div>

      <p v-if="open" class="note gap-top">Geen spoed: je krijgt een melding als de coördinator het oppakt. Bij spoed: bel de coördinator.</p>

      <div class="grow" />
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div class="stack gap-8 bottom">
        <a v-if="open && coordinator" :href="telHref(coordinator.phone)" class="btn">Bel evenementcoördinator</a>
        <button class="btn primary" @click="toPost">Terug naar mijn post</button>
        <button v-if="open" class="btn link muted" :disabled="busy" @click="withdraw">Aanvraag intrekken</button>
      </div>
    </template>
  </main>
</template>

<style scoped>
.top-gap { margin-top: 24px; }
.gap-top { margin-top: 14px; }
.steps { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; font-size: 14px; }
.step { display: flex; gap: 12px; align-items: center; }
.step.later { color: var(--muted); }
.mark { width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%; border: 2px solid #A8A59C; display: flex; align-items: center; justify-content: center; }
.mark.done { border: none; background: var(--ok); color: #FFFFFF; }
.bottom { padding-top: 14px; }
.muted { color: var(--muted); }
</style>
