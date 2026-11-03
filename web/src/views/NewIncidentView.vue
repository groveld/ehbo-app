<script setup lang="ts">
// 4.1 · Post: EHBO-verzoek invullen. Alles is optioneel; versturen kan meteen. Met incidentId: een verstuurde melding aanvullen.
// Without a post (/help, #102): help to where you are, with the GPS position sent once with the request.
import { computed, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { INCIDENT_PERSONS, INCIDENT_WHAT, NOTE_MAX, RESPONSIVE, placeOf, type IncidentDetails } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import Sos112Bar from '../components/Sos112Bar.vue';
import { useDirty } from '../composables/useDirty.ts';
import { useGpsFix } from '../composables/useGpsFix.ts';
import { atPostM, kmLabel } from '../posts.ts';
import { OfflineError, useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const props = defineProps<{ id?: string; incidentId?: string }>();
const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();

const existing = computed(() => (props.incidentId ? live.incidentById(Number(props.incidentId)) : null));
const post = computed(() => store.postById.get(existing.value?.postId ?? Number(props.id)) ?? null);
/** Help to where you are: no post, no addition. */
const here = computed(() => !props.id && !props.incidentId);
const gps = useGpsFix();
onMounted(() => { if (here.value) void gps.start(); });
/** Above this the team may not find you: say where you are in the note. */
const ROUGH_M = 100;
const place = computed(() => (gps.best.value && store.pkg ? placeOf(store.pkg.posts, [gps.best.value.lng, gps.best.value.lat], atPostM(store.pkg)) : null));
const form = reactive<IncidentDetails>({
  what: existing.value?.what ?? null,
  persons: existing.value?.persons ?? null,
  responsive: existing.value?.responsive ?? null,
  note: existing.value?.note ?? '',
});
const busy = ref(false);
const error = ref('');
// Een nieuw verzoek kan altijd meteen weg; een aanvulling pas als er iets veranderd is.
const { dirty, markClean } = useDirty(() => form);
markClean();

/** Nog eens tikken op een gekozen antwoord haalt het weg; alles blijft optioneel. */
const toggle = <K extends keyof IncidentDetails>(key: K, value: IncidentDetails[K]) => {
  form[key] = form[key] === value ? null : value;
};

async function send() {
  if (here.value ? !gps.best.value : !post.value) return;
  busy.value = true;
  error.value = '';
  const details = { ...form, note: form.note?.trim() || null };
  try {
    if (existing.value) {
      await live.update(existing.value.id, details);
      router.replace({ name: 'incident', params: { id: existing.value.id } });
    } else if (here.value) {
      const { lat, lng, accuracyM } = gps.best.value!;
      const incident = await live.report({ postId: null, lat, lng, accuracyM, ...details });
      router.replace({ name: 'incident', params: { id: incident.id } });
    } else {
      const incident = await live.report({ postId: post.value!.id, ...details });
      router.replace({ name: 'incident', params: { id: incident.id } });
    }
  } catch (err) {
    // Geen bereik: de melding wacht op de telefoon; intussen bel je zelf (4.9).
    if (err instanceof OfflineError) router.replace({ name: 'no-signal', params: { clientId: err.clientId } });
    else error.value = err instanceof TypeError ? 'Geen bereik. Probeer het zo opnieuw, of bel de EHBO.' : (err as Error).message;
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="screen tight">
    <header class="page-header">
      <button class="icon-btn" aria-label="Terug" @click="router.back()"><Icon name="back" /></button>
      <div>
        <span class="eyebrow">{{ here ? 'Waar je nu bent' : [post?.name, post ? kmLabel(post) : null].filter(Boolean).join(' · ') }}</span>
        <h1>{{ existing ? 'Melding aanvullen' : here ? 'EHBO hierheen' : 'EHBO aanvragen' }}</h1>
      </div>
    </header>

    <!-- Where you are: the team navigates to this position. -->
    <div v-if="here" class="card where" :class="{ rough: gps.best.value && gps.best.value.accuracyM > ROUGH_M }" role="status">
      <Icon name="pin" :size="20" />
      <span class="stack grow">
        <template v-if="gps.best.value">
          <strong>{{ place?.name ?? 'Je locatie' }}</strong>
          <span class="small">Nauwkeurig op ± {{ gps.best.value.accuracyM }} m<template v-if="gps.measuring.value"> · nog aan het verbeteren</template></span>
          <span v-if="gps.best.value.accuracyM > ROUGH_M" class="small">Onnauwkeurig: zeg in de toelichting waar je bent.</span>
        </template>
        <template v-else-if="gps.measuring.value"><strong>Locatie zoeken…</strong><span class="small">Even geduld, of bel 112 bij levensgevaar.</span></template>
        <template v-else>
          <strong>Geen locatie</strong>
          <span class="small">{{ gps.error.value }} Vraag hulp vanaf je locatie, of bel de EHBO.</span>
          <button class="btn link" @click="gps.start()">Opnieuw zoeken</button>
        </template>
      </span>
    </div>

    <Sos112Bar class="sos"><strong>Levensgevaar?</strong> <span class="normal">Bel eerst 112, vul daarna dit in.</span></Sos112Bar>

    <div class="stack gap-14 fields">
      <div class="stack gap-8">
        <span class="q">Wat is er aan de hand?</span>
        <div class="choice-grid two">
          <button v-for="(label, key) in INCIDENT_WHAT" :key="key" class="option" :aria-pressed="form.what === key" @click="toggle('what', key)">{{ label }}</button>
        </div>
      </div>

      <div class="persons">
        <span class="q grow">Aantal personen</span>
        <button v-for="n in INCIDENT_PERSONS" :key="n" class="option square" :aria-pressed="form.persons === n" @click="toggle('persons', n)">{{ n }}</button>
      </div>

      <div class="stack gap-8">
        <span class="q">Is de persoon aanspreekbaar?</span>
        <div class="choice-grid">
          <button v-for="(label, key) in RESPONSIVE" :key="key" class="option" :aria-pressed="form.responsive === key" @click="toggle('responsive', key)">{{ label }}</button>
        </div>
        <span class="aed">Bij "nee" gaat de dichtstbijzijnde eenheid met AED direct mee. Bel ook 112.</span>
      </div>

      <div class="form-field">
        <label for="toelichting" class="q">Toelichting (optioneel)</label>
        <textarea id="toelichting" v-model="form.note" class="input" rows="2" :maxlength="NOTE_MAX" placeholder="Bijv. zit naast de kraam, loper met rood shirt" />
      </div>
    </div>

    <div class="grow" />
    <div class="stack gap-6 footer">
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <button v-if="!existing || dirty" class="btn danger" :disabled="busy || (here && !gps.best.value)" @click="send">
        <Icon name="bell" :size="20" />{{ busy ? 'Versturen…' : existing ? 'Aanvulling versturen' : 'EHBO-verzoek versturen' }}
      </button>
      <span v-if="!existing" class="small center">Alles is optioneel: versturen kan meteen</span>
    </div>
  </main>
</template>

<style scoped>
.sos { margin-top: 6px; }
.where { display: flex; align-items: flex-start; gap: 12px; margin-top: 10px; }
.where.rough { box-shadow: 0 0 0 2px var(--warn-line); }
.where .btn.link { align-self: flex-start; padding: 0; min-height: 44px; }
.sos :deep(.text) { font-size: 14px; font-weight: 400; }
.normal { font-weight: 400; }
.fields { padding-top: 16px; }
.q { font-size: 14px; font-weight: 600; }
.persons { display: flex; align-items: center; gap: 8px; }
.square { width: 48px; }
.aed { font-size: 12px; color: var(--warn); line-height: 1.4; }
.footer { padding-top: 12px; }
.center { text-align: center; }
</style>
