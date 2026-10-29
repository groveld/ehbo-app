<script setup lang="ts">
// 4.8 · EHBO: incident afronden. Afloop, korte notitie (geen namen of medische details) en waar je daarna bent.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NOTE_MAX, OUTCOMES, type Outcome } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import { useSave } from '../composables/useSave.ts';
import { clock, unitOf } from '../incidents.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();
const { busy, error, run } = useSave();

const incident = computed(() => live.incidentById(Number(props.id)));
const post = computed(() => (incident.value ? store.postById.get(incident.value.postId) : undefined));
const myUnit = computed(() => unitOf(store.pkg, incident.value?.dispatches.find((d) => d.acceptedAt && live.myUnitIds.includes(d.unitId))?.unitId ?? null));
const ownPost = computed(() => (myUnit.value?.postId != null ? store.postById.get(myUnit.value.postId) : undefined));
/** Alleen een vaste eenheid die niet op haar eigen post is, kan "even blijven". */
const canStay = computed(() => myUnit.value?.kind === 'vast' && ownPost.value && ownPost.value.id !== post.value?.id);

const outcome = ref<Outcome | null>(null);
const note = ref('');
const stayHere = ref(true);

async function finish(pause = false) {
  if (!incident.value || !outcome.value) return;
  const ok = await run(() => live.close(incident.value!.id, {
    outcome: outcome.value!, persons: incident.value!.persons, note: note.value.trim() || null, stayHere: Boolean(canStay.value && stayHere.value), pause,
  }));
  if (ok) router.replace({ name: 'stand-by' });
}
</script>

<template>
  <main class="screen tight">
    <header class="page-header">
      <button class="icon-btn" aria-label="Terug" @click="router.back()"><Icon name="back" /></button>
      <div>
        <span class="eyebrow">{{ post?.name }}<template v-if="incident?.onSiteAt"> · ter plaatse sinds {{ clock(incident.onSiteAt) }}</template></span>
        <h1>Incident afronden</h1>
      </div>
    </header>

    <p v-if="!incident || !post" class="note warn">Deze oproep staat (nog) niet op deze telefoon.</p>
    <div v-else class="stack gap-14 fields">
      <div class="stack gap-8">
        <span class="q">Afloop</span>
        <div class="choice-grid two">
          <button v-for="(label, key) in OUTCOMES" :key="key" class="option" :aria-pressed="outcome === key" @click="outcome = key">{{ label }}</button>
        </div>
      </div>

      <div class="form-field">
        <label for="notitie" class="q">Korte notitie</label>
        <textarea id="notitie" v-model="note" class="input" rows="2" :maxlength="NOTE_MAX" />
        <span class="small">Geen namen of medische details. Komt in het evenementrapport.</span>
      </div>

      <div v-if="canStay" class="stack gap-8">
        <span class="q">Waar ben je na afloop?</span>
        <button class="card where" :aria-pressed="stayHere" @click="stayHere = true">
          <span class="radio" />
          <span class="stack"><strong>Ik blijf hier even</strong><span class="small">Telt als dichtstbij voor {{ post.name }} en omgeving</span></span>
        </button>
        <button class="card where" :aria-pressed="!stayHere" @click="stayHere = false">
          <span class="radio" />
          <span class="stack"><strong>Terug naar {{ ownPost!.name }}</strong><span class="small">Weer beschikbaar vanaf je vaste post</span></span>
        </button>
      </div>
    </div>

    <div class="grow" />
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="!outcome" class="small center">Kies de afloop om af te ronden.</p>
    <button class="btn go footer" :disabled="busy || !outcome" @click="finish()">Afronden &amp; weer beschikbaar</button>
    <button class="btn pause" :disabled="busy || !outcome" @click="finish(true)">Afronden &amp; even pauze</button>
  </main>
</template>

<style scoped>
.fields { padding-top: 4px; }
.q { font-size: 14px; font-weight: 600; }
.where { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 14px; border: 1px solid #D4D1C7; font: inherit; color: var(--ink); text-align: left; cursor: pointer; }
.where[aria-pressed="true"] { border: 2px solid var(--ink); }
.where strong { font-size: 14px; }
.radio { width: 20px; height: 20px; flex-shrink: 0; border-radius: 50%; border: 2px solid #A8A59C; }
.where[aria-pressed="true"] .radio { border: 6px solid var(--ink); }
.center { text-align: center; }
.footer { margin-top: 8px; }
.pause { margin-top: 8px; }
</style>
