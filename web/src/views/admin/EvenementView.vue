<script setup lang="ts">
// 1.1 · Evenement instellen: naam, data, lopen en de EHBO-escalatietijd. Stijl en logo's volgen later.
import { reactive, ref, watchEffect } from 'vue';
import { ESCALATION_MAX_SECONDS, ESCALATION_MIN_SECONDS, type EventSettings } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';

const admin = useAdminStore();
const form = reactive<EventSettings>({ name: '', startLocation: null, startDate: null, endDate: null, escalationSeconds: 30 });
const loaded = ref(false);
const saved = ref(false);
const { busy, error, run } = useSave();

// Formulier vullen zodra de gegevens er zijn (ook als ze nog geladen moesten worden).
watchEffect(() => {
  if (loaded.value || !admin.state) return;
  Object.assign(form, admin.state.event);
  loaded.value = true;
});

const step = (delta: number) => {
  form.escalationSeconds = Math.min(ESCALATION_MAX_SECONDS, Math.max(ESCALATION_MIN_SECONDS, form.escalationSeconds + delta));
};

async function save() {
  saved.value = false;
  saved.value = await run(() => admin.saveEvent({ ...form, startDate: form.startDate || null, endDate: form.endDate || null }));
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

      <div class="card escalation">
        <span class="grow"><strong>EHBO-escalatie:</strong> naar alle EHBO-eenheden na</span>
        <button class="step" aria-label="Minder" @click="step(-5)">−</button>
        <span class="mono seconds">{{ form.escalationSeconds }} s</span>
        <button class="step" aria-label="Meer" @click="step(5)">+</button>
      </div>
    </template>

    <template #footer>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <p v-else-if="saved" class="small" role="status">Opgeslagen.</p>
      <button class="btn primary" :disabled="busy || !form.name.trim()" @click="save">Opslaan</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.escalation { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.step { width: 44px; height: 44px; flex-shrink: 0; border-radius: 10px; border: 1px solid #D4D1C7; background: #FFFFFF; font: 600 16px var(--sans); color: var(--ink); cursor: pointer; }
.seconds { min-width: 44px; text-align: center; font-size: 15px; }
.tag { margin-left: 0; flex-shrink: 0; }
</style>
