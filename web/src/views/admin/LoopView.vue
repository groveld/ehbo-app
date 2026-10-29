<script setup lang="ts">
// Eén loop: naam, afstand, soort, datum, starttijd en het parcours als GPX.
import { computed, reactive, ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import type { RunData } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import { useDirty } from '../../composables/useDirty.ts';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';

const props = defineProps<{ id: string }>();
const admin = useAdminStore();
const router = useRouter();
const isNew = computed(() => props.id === 'nieuw');
const run = computed(() => admin.state?.runs.find((r) => r.id === Number(props.id)) ?? null);

const form = reactive<RunData & { distanceText: string }>({ name: '', distanceKm: null, distanceText: '', discipline: 'lopen + wandelen', date: null, startTime: null });
const loaded = ref(false);
// Een nieuwe post, eenheid of loop is nog niet opgeslagen; een bestaande alleen als er iets gewijzigd is.
const { dirty, markClean } = useDirty(() => form);
const canSave = computed(() => isNew.value || dirty.value);
watchEffect(() => {
  if (loaded.value || !admin.state) return;
  if (run.value) Object.assign(form, run.value, { distanceText: run.value.distanceKm?.toLocaleString('nl-NL') ?? '' });
  else form.date = admin.state.event.startDate;
  markClean();
  loaded.value = true;
});

const save = useSave();
const upload = useSave();
const km = (value: number) => value.toLocaleString('nl-NL', { maximumFractionDigits: 2 });

async function submit() {
  const distance = form.distanceText.trim() ? Number(form.distanceText.replace(',', '.')) : null;
  if (distance !== null && !Number.isFinite(distance)) {
    save.error.value = 'Vul de afstand in als getal, bijv. 21,1';
    return;
  }
  const data: RunData = { name: form.name, distanceKm: distance, discipline: form.discipline || null, date: form.date || null, startTime: form.startTime || null };
  if (await save.run(() => admin.saveRun(isNew.value ? null : Number(props.id), data))) router.push({ name: 'beheer-evenement' });
}

async function remove() {
  if (!confirm(`${form.name} verwijderen, met het parcours?`)) return;
  if (await save.run(() => admin.deleteRun(Number(props.id)))) router.push({ name: 'beheer-evenement' });
}

async function onFile(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  if (file) await upload.run(() => admin.uploadGpx(Number(props.id), file));
  input.value = '';
}
</script>

<template>
  <AdminPage :title="isNew ? 'Nieuwe loop' : form.name || 'Loop'" eyebrow="Evenement" :back="{ name: 'beheer-evenement' }">
    <p v-if="!isNew && !run" class="note warn">Deze loop bestaat niet (meer).</p>
    <template v-else>
      <div class="form-field">
        <label for="loop-naam">Naam</label>
        <input id="loop-naam" v-model="form.name" class="input" placeholder="Bijv. 10 km" required>
      </div>
      <div class="row-2">
        <div class="form-field">
          <label for="loop-km">Afstand (km)</label>
          <input id="loop-km" v-model="form.distanceText" class="input" inputmode="decimal" placeholder="21,1">
        </div>
        <div class="form-field">
          <label for="loop-tijd">Starttijd</label>
          <input id="loop-tijd" v-model="form.startTime" class="input" type="time">
        </div>
      </div>
      <div class="form-field">
        <span class="section-label">Soort</span>
        <div class="choice-grid">
          <button v-for="d in ['hardlopen', 'wandelen', 'hardlopen + wandelen']" :key="d" class="option" :aria-pressed="form.discipline === d" @click="form.discipline = d">{{ d }}</button>
        </div>
        <span class="small">Hardlopen en wandelen op dezelfde route zijn één loop; een afwijkende route wordt een eigen loop.</span>
      </div>
      <div class="form-field">
        <label for="loop-datum">Datum</label>
        <input id="loop-datum" v-model="form.date" class="input" type="date">
      </div>

      <section v-if="!isNew" class="stack gap-8">
        <span class="section-label">Parcours (GPX)</span>
        <div class="card stack gap-6">
          <template v-if="run?.gpx">
            <span><strong>{{ run.gpx.filename }}</strong></span>
            <span class="small">{{ km(run.gpx.km) }} km · {{ run.gpx.points.toLocaleString('nl-NL') }} punten</span>
            <span v-if="run.distanceKm && Math.abs(run.gpx.km - run.distanceKm) > run.distanceKm * 0.1" class="note warn">
              Het parcours is {{ km(run.gpx.km) }} km, de loop {{ km(run.distanceKm) }} km. Klopt het bestand?
            </span>
          </template>
          <span v-else class="small">Nog geen parcours. Het GPX-bestand zet de route op de kaart.</span>
          <label class="btn file">
            {{ upload.busy.value ? 'Bezig…' : run?.gpx ? 'Ander GPX-bestand kiezen' : 'GPX-bestand kiezen' }}
            <input type="file" accept=".gpx,application/gpx+xml,application/xml,text/xml" class="visually-hidden" @change="onFile">
          </label>
          <p v-if="upload.error.value" class="error-text" role="alert">{{ upload.error.value }}</p>
        </div>
      </section>
      <p v-else class="small">Na opslaan kun je het parcours (GPX) toevoegen.</p>
    </template>

    <template #footer>
      <p v-if="save.error.value" class="error-text" role="alert">{{ save.error.value }}</p>
      <button v-if="canSave" class="btn primary" :disabled="save.busy.value || !form.name.trim() || (!isNew && !run)" @click="submit">Opslaan</button>
      <button v-if="!isNew && run" class="btn link danger-link" @click="remove">Loop verwijderen</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.file { cursor: pointer; }
</style>
