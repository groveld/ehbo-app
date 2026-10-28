<script setup lang="ts">
// 4.1 · Post: EHBO-verzoek invullen. Alles is optioneel; versturen kan meteen. Met incidentId: een verstuurde melding aanvullen.
import { computed, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { INCIDENT_PERSONS, INCIDENT_WHAT, NOTE_MAX, RESPONSIVE, type IncidentDetails } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import Sos112Bar from '../components/Sos112Bar.vue';
import { kmLabel } from '../posts.ts';
import { OfflineError, useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const props = defineProps<{ id?: string; incidentId?: string }>();
const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();

const existing = computed(() => (props.incidentId ? live.incidentById(Number(props.incidentId)) : null));
const post = computed(() => store.postById.get(existing.value?.postId ?? Number(props.id)) ?? null);
const form = reactive<IncidentDetails>({
  what: existing.value?.what ?? null,
  persons: existing.value?.persons ?? null,
  responsive: existing.value?.responsive ?? null,
  note: existing.value?.note ?? '',
});
const busy = ref(false);
const error = ref('');

/** Nog eens tikken op een gekozen antwoord haalt het weg; alles blijft optioneel. */
const toggle = <K extends keyof IncidentDetails>(key: K, value: IncidentDetails[K]) => {
  form[key] = form[key] === value ? null : value;
};

async function send() {
  if (!post.value) return;
  busy.value = true;
  error.value = '';
  const details = { ...form, note: form.note?.trim() || null };
  try {
    if (existing.value) {
      await live.update(existing.value.id, details);
      router.replace({ name: 'melding', params: { id: existing.value.id } });
    } else {
      const incident = await live.report({ postId: post.value.id, ...details });
      router.replace({ name: 'melding', params: { id: incident.id } });
    }
  } catch (err) {
    // Geen bereik: de melding wacht op de telefoon; intussen bel je zelf (4.9).
    if (err instanceof OfflineError) router.replace({ name: 'geen-bereik', params: { clientId: err.clientId } });
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
        <span class="eyebrow">{{ [post?.name, post ? kmLabel(post.km) : null].filter(Boolean).join(' · ') }}</span>
        <h1>{{ existing ? 'Melding aanvullen' : 'EHBO aanvragen' }}</h1>
      </div>
    </header>

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
      <button class="btn danger" :disabled="busy" @click="send">
        <Icon name="bell" :size="20" />{{ busy ? 'Versturen…' : existing ? 'Aanvulling versturen' : 'EHBO-verzoek versturen' }}
      </button>
      <span v-if="!existing" class="small center">Alles is optioneel: versturen kan meteen</span>
    </div>
  </main>
</template>

<style scoped>
.sos { margin-top: 6px; }
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
