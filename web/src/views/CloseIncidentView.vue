<script setup lang="ts">
// 4.8 · EHBO: incident afronden. Afloop, korte notitie (geen namen of medische details) en waar je daarna bent.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { NOTE_MAX, OUTCOMES, type Outcome, type TeamAvailability } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import NotOnPhone from '../components/NotOnPhone.vue';
import { useSave } from '../composables/useSave.ts';
import { clock, locationOf, teamOf } from '../incidents.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();
const { busy, error, run } = useSave();

const incident = computed(() => live.incidentById(Number(props.id)));
const location = computed(() => (incident.value ? locationOf(store.locationById, incident.value) : undefined));
const myTeam = computed(() => teamOf(store.pkg, incident.value?.dispatches.find((d) => d.acceptedAt && live.myTeamIds.includes(d.teamId))?.teamId ?? null));
const ownLocation = computed(() => (myTeam.value?.locationId != null ? store.locationById.get(myTeam.value.locationId) : undefined));
/** Alleen een vaste eenheid die niet op haar eigen post is, kan "even blijven". */
const canStay = computed(() => myTeam.value?.kind === 'fixed' && ownLocation.value && ownLocation.value.id !== location.value?.id);

const outcome = ref<Outcome | null>(null);
const note = ref('');
const stayHere = ref(true);

/** The status picked during the call is the main button; the other way out is below it. */
const planned = computed(() => (myTeam.value ? live.teamState(myTeam.value.id)?.nextAvailability ?? null : null));
const FINISH: Record<TeamAvailability, string> = { available: 'Afronden & weer beschikbaar', unavailable: 'Afronden & pauze', off_duty: 'Afronden & uit dienst' };

async function finish(then: TeamAvailability) {
  if (!incident.value || !outcome.value) return;
  const ok = await run(() => live.close(incident.value!.id, {
    outcome: outcome.value!, persons: incident.value!.persons, note: note.value.trim() || null, stayHere: Boolean(canStay.value && stayHere.value), then,
  }));
  if (ok) router.replace({ name: 'first-aid' });
}
</script>

<template>
  <main class="screen tight">
    <header class="page-header">
      <button class="icon-btn" aria-label="Terug" @click="router.back()"><Icon name="back" /></button>
      <div>
        <span class="eyebrow">{{ location?.name }}<template v-if="incident?.onSiteAt"> · ter plaatse sinds {{ clock(incident.onSiteAt) }}</template></span>
        <h1>Incident afronden</h1>
      </div>
    </header>

    <NotOnPhone v-if="!incident || !location">Deze oproep staat (nog) niet op deze telefoon.</NotOnPhone>
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
          <span class="stack"><strong>Ik blijf hier even</strong><span class="small">Telt als dichtstbij voor {{ location.name }} en omgeving</span></span>
        </button>
        <button class="card where" :aria-pressed="!stayHere" @click="stayHere = false">
          <span class="radio" />
          <span class="stack"><strong>Terug naar {{ ownLocation!.name }}</strong><span class="small">Weer beschikbaar vanaf je eigen EHBO-post</span></span>
        </button>
      </div>
    </div>

    <div class="grow" />
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <p v-else-if="!outcome" class="small center">Kies de afloop om af te ronden.</p>
    <button class="btn footer" :class="planned ? 'primary' : 'go'" :disabled="busy || !outcome" @click="finish(planned ?? 'available')">{{ FINISH[planned ?? 'available'] }}</button>
    <button class="btn pause" :disabled="busy || !outcome" @click="finish(planned ? 'available' : 'unavailable')">{{ FINISH[planned ? 'available' : 'unavailable'] }}</button>
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
