<script setup lang="ts">
// 1.1 · Evenement instellen: naam, data, lopen, de kaart, stijl en de EHBO-escalatietijd.
import { computed, onBeforeUnmount, reactive, ref, watch, watchEffect } from 'vue';
import { DEFAULT_STYLE, ESCALATION_MAX_SECONDS, ESCALATION_MIN_SECONDS, SHORT_NAME_MAX, styleProblem, type EventSettings } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import MapSection from './MapSection.vue';
import { useDirty } from '../../composables/useDirty.ts';
import { useSave } from '../../composables/useSave.ts';
import { IMAGE_ACCEPT } from '../../images.ts';
import { useAdminStore } from '../../stores/admin.ts';
import { useSessionStore } from '../../stores/session.ts';
import { applyTheme } from '../../theme.ts';

const admin = useAdminStore();
const session = useSessionStore();
const form = reactive<EventSettings>({ name: '', startLocation: null, startDate: null, endDate: null, escalationSeconds: 30, style: { ...DEFAULT_STYLE } });
const loaded = ref(false);
const saved = ref(false);
const { busy, error, run } = useSave();
const logoUpload = useSave();
const { dirty, markClean } = useDirty(() => form);

// Formulier vullen zodra de gegevens er zijn (ook als ze nog geladen moesten worden).
watchEffect(() => {
  if (loaded.value || !admin.state) return;
  Object.assign(form, { ...admin.state.event, style: { ...admin.state.event.style } });
  markClean();
  loaded.value = true;
});

const colorProblem = computed(() => styleProblem(form.style));
const isDefaultColors = computed(() => form.style.primaryColor === DEFAULT_STYLE.primaryColor && form.style.accentColor === DEFAULT_STYLE.accentColor);

// Kleuren direct laten zien; wie weggaat zonder op te slaan, krijgt de opgeslagen kleuren terug.
watch(() => [form.style.primaryColor, form.style.accentColor], () => {
  if (loaded.value) applyTheme(session.event && { ...session.event, style: { ...session.event.style, ...form.style } });
});
onBeforeUnmount(() => applyTheme(session.event));

function resetColors() {
  form.style.primaryColor = DEFAULT_STYLE.primaryColor;
  form.style.accentColor = DEFAULT_STYLE.accentColor;
}

async function onLogo(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) await logoUpload.run(() => admin.uploadLogo(file));
}

const step = (delta: number) => {
  form.escalationSeconds = Math.min(ESCALATION_MAX_SECONDS, Math.max(ESCALATION_MIN_SECONDS, form.escalationSeconds + delta));
};

async function save() {
  saved.value = false;
  saved.value = await run(() => admin.saveEvent({ ...form, startDate: form.startDate || null, endDate: form.endDate || null }));
  if (saved.value) markClean();
}

const km = (value: number) => value.toLocaleString('nl-NL', { maximumFractionDigits: 1 });
</script>

<template>
  <AdminPage title="Evenement" eyebrow="Beheer" :back="{ name: 'beheer' }">
    <template #default="{ state }">
      <div class="form-field">
        <label for="ev-naam">Naam evenement</label>
        <input id="ev-naam" v-model="form.name" class="input" required>
      </div>
      <div class="row-2">
        <div class="form-field">
          <label for="ev-begin">Begindatum</label>
          <input id="ev-begin" v-model="form.startDate" class="input" type="date">
        </div>
        <div class="form-field">
          <label for="ev-eind">Einddatum</label>
          <input id="ev-eind" v-model="form.endDate" class="input" type="date" :min="form.startDate ?? undefined">
        </div>
      </div>
      <div class="form-field">
        <label for="ev-start">Startlocatie</label>
        <input id="ev-start" v-model="form.startLocation" class="input" placeholder="Bijv. Eetcafé De Trilker, Poppenwier">
      </div>

      <section class="stack gap-8">
        <span class="section-label">Lopen</span>
        <div v-if="state.runs.length" class="list">
          <RouterLink v-for="r in state.runs" :key="r.id" :to="{ name: 'beheer-loop', params: { id: r.id } }" class="list-row">
            <span class="main">
              <span class="title-line">{{ r.name }}</span>
              <span class="sub">{{ [r.discipline, r.startTime].filter(Boolean).join(' · ') || 'Geen starttijd' }}</span>
            </span>
            <span v-if="r.gpx" class="tag ok">GPX · {{ km(r.gpx.km) }} km</span>
            <span v-else class="tag warn">GPX ontbreekt</span>
            <Icon name="forward" :size="18" />
          </RouterLink>
        </div>
        <RouterLink :to="{ name: 'beheer-loop', params: { id: 'nieuw' } }" class="add-link">+ Loop toevoegen</RouterLink>
      </section>

      <MapSection />

      <section class="stack gap-8">
        <span class="section-label">Stijl</span>
        <div class="logos">
          <label class="card logo-card" :class="{ busy: logoUpload.busy.value }">
            <img v-if="state.brand.logo" :src="state.brand.logo" alt="Groot logo" class="logo-large">
            <span v-else class="logo-large placeholder">{{ form.name || 'Groot logo' }}</span>
            <span class="small">{{ logoUpload.busy.value ? 'Bezig…' : 'Groot logo · startscherm, rapport' }}</span>
            <input type="file" :accept="IMAGE_ACCEPT" class="visually-hidden" @change="onLogo">
          </label>
          <RouterLink :to="{ name: 'beheer-app-icoon' }" class="card logo-card">
            <img :src="state.brand.icon ?? '/icons/icon-192.png'" alt="Vierkant logo" width="48" height="48" class="logo-square">
            <span class="small">Vierkant · app-icoon</span>
          </RouterLink>
        </div>
        <button v-if="state.brand.logo" class="add-link remove" :disabled="logoUpload.busy.value" @click="logoUpload.run(admin.deleteLogo)">Groot logo verwijderen</button>
        <p v-if="logoUpload.error.value" class="error-text" role="alert">{{ logoUpload.error.value }}</p>

        <div class="card colors">
          <span class="grow"><strong>Kleuren</strong></span>
          <button v-if="!isDefaultColors" class="add-link" @click="resetColors">Standaard</button>
          <input v-model="form.style.primaryColor" type="color" class="swatch" aria-label="Hoofdkleur (knoppen, witte tekst)">
          <input v-model="form.style.accentColor" type="color" class="swatch" aria-label="Accentkleur (vlakken, donkere tekst)">
        </div>
        <p v-if="colorProblem" class="note warn" role="alert">{{ colorProblem }}.</p>

        <div class="form-field">
          <label for="ev-kort">Korte naam onder het app-icoon</label>
          <input id="ev-kort" v-model="form.style.shortName" class="input" :maxlength="SHORT_NAME_MAX" :placeholder="form.name.slice(0, SHORT_NAME_MAX)">
        </div>
      </section>

      <div class="card escalation">
        <span class="grow"><strong>EHBO-escalatie:</strong></span>
        <button class="step" aria-label="Minder" @click="step(-5)">−</button>
        <span class="mono seconds">{{ form.escalationSeconds }} s</span>
        <button class="step" aria-label="Meer" @click="step(5)">+</button>
      </div>
    </template>

    <!-- Opslaan alleen als er iets gewijzigd is. -->
    <template v-if="dirty || error || saved" #footer>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <p v-else-if="saved && !dirty" class="small" role="status">Opgeslagen.</p>
      <button v-if="dirty" class="btn primary" :disabled="busy || !form.name.trim() || colorProblem !== null" @click="save">Opslaan</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.escalation { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.step { width: 44px; height: 44px; flex-shrink: 0; border-radius: 10px; border: 1px solid #D4D1C7; background: #FFFFFF; font: 600 16px var(--sans); color: var(--ink); cursor: pointer; }
.seconds { min-width: 44px; text-align: center; font-size: 15px; }
.tag { margin-left: 0; flex-shrink: 0; }
.logos { display: grid; grid-template-columns: 2fr 1fr; gap: 8px; }
.logo-card { display: flex; flex-direction: column; gap: 6px; padding: 10px; border-radius: 14px; color: var(--ink); text-decoration: none; cursor: pointer; }
.logo-card.busy { opacity: .6; }
.logo-large { height: 48px; max-width: 100%; align-self: flex-start; object-fit: contain; object-position: left center; }
.logo-large.placeholder {
  align-self: stretch; display: flex; align-items: center; padding: 0 10px; border-radius: 10px; overflow: hidden; white-space: nowrap;
  background: var(--accent); font-size: 14px; font-weight: 700; letter-spacing: -0.01em; text-transform: uppercase;
}
.logo-square { border-radius: 12px; }
.remove { align-self: flex-start; color: var(--danger); }
.colors { display: flex; align-items: center; gap: 4px; padding: 4px 6px 4px 14px; border-radius: 14px; font-size: 13px; }
.colors .add-link { margin-right: 6px; font-size: 13px; }
/* Kleurkiezer als rondje van 26 px, met een tikvlak van 44 × 44. */
.swatch { width: 44px; height: 44px; padding: 9px; border: none; background: none; cursor: pointer; -webkit-appearance: none; appearance: none; }
.swatch::-webkit-color-swatch-wrapper { padding: 0; }
.swatch::-webkit-color-swatch { border: 1px solid var(--line); border-radius: 50%; }
.swatch::-moz-color-swatch { border: 1px solid var(--line); border-radius: 50%; }
</style>
