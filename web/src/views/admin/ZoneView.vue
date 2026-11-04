<script setup lang="ts">
// One zone (#172): kind, shape, name, a note, and the zone itself, drawn by tapping points on the map.
import { computed, reactive, ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { ZONE_KIND_ORDER, ZONE_KINDS, ZONE_SHAPES, zoneProblem, type ZoneData } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import EventMap from '../../components/EventMap.vue';
import { useDirty } from '../../composables/useDirty.ts';
import { confirmDialog } from '../../composables/useDialog.ts';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';
import { usePackageStore } from '../../stores/package.ts';

const props = defineProps<{ id: string }>();
const admin = useAdminStore();
const pkg = usePackageStore();
const router = useRouter();
const save = useSave();
const isNew = computed(() => props.id === 'nieuw');
const zone = computed(() => admin.state?.zones.find((z) => z.id === Number(props.id)) ?? null);

const form = reactive<ZoneData>({ kind: 'parking', shape: 'strip', name: '', note: null, points: [] });
const loaded = ref(false);
const { dirty, markClean } = useDirty(() => form);
const canSave = computed(() => isNew.value || dirty.value);
watchEffect(() => {
  if (loaded.value || !admin.state) return;
  if (zone.value) Object.assign(form, { ...zone.value, points: zone.value.points.map((p) => [...p]) });
  markClean();
  loaded.value = true;
});

/** The others as they are; this one is drawn from the form, so every tap shows at once. */
const otherZones = computed(() => pkg.pkg?.zones.filter((z) => z.id !== Number(props.id)) ?? []);
const problem = computed(() => zoneProblem(form));
const hint = computed(() => (form.shape === 'strip'
  ? 'Tik punt voor punt langs de weg, van het ene eind naar het andere.'
  : 'Tik de hoeken van het vlak rondom; het vlak sluit vanzelf.'));

async function submit() {
  if (problem.value) {
    save.error.value = problem.value;
    return;
  }
  const data: ZoneData = { kind: form.kind, shape: form.shape, name: form.name, note: form.note?.trim() || null, points: form.points };
  if (await save.run(() => admin.saveZone(isNew.value ? null : Number(props.id), data))) router.push({ name: 'admin-zones' });
}

async function clearPoints() {
  if (await confirmDialog({ title: 'Opnieuw tekenen?', text: 'Alle punten van deze zone gaan weg.', confirm: 'Opnieuw tekenen', tone: 'danger' })) form.points = [];
}

async function remove() {
  if (!await confirmDialog({ title: `${form.name} verwijderen?`, text: 'De zone verdwijnt van de kaart, ook bij deelnemers.', confirm: 'Verwijderen', tone: 'danger' })) return;
  if (await save.run(() => admin.deleteZone(Number(props.id)))) router.push({ name: 'admin-zones' });
}
</script>

<template>
  <AdminPage :title="isNew ? 'Nieuwe zone' : form.name || 'Zone'" eyebrow="Zones" :back="{ name: 'admin-zones' }">
    <p v-if="!isNew && !zone" class="note warn">Deze zone bestaat niet (meer).</p>
    <template v-else>
      <div class="form-field">
        <span class="section-label">Soort</span>
        <div class="choice-grid two">
          <button v-for="k in ZONE_KIND_ORDER" :key="k" class="option" :aria-pressed="form.kind === k" @click="form.kind = k">{{ ZONE_KINDS[k].label }}</button>
        </div>
      </div>
      <div class="form-field">
        <label for="zone-naam">Naam</label>
        <input id="zone-naam" v-model="form.name" class="input" maxlength="60" placeholder="Bijv. Parkeren Dorpsstraat" required>
      </div>
      <div class="form-field">
        <label for="zone-notitie">Notitie (optioneel)</label>
        <input id="zone-notitie" v-model="form.note" class="input" maxlength="200" placeholder="Bijv. vol vanaf 11:00">
      </div>

      <div class="form-field">
        <span class="section-label">Vorm</span>
        <div class="choice-grid two">
          <button v-for="(s, key) in ZONE_SHAPES" :key="key" class="option" :aria-pressed="form.shape === key" @click="form.shape = key">{{ s.label }}</button>
        </div>
      </div>

      <div class="form-field">
        <span class="section-label">Op de kaart</span>
        <div v-if="pkg.pkg" class="draw-map">
          <EventMap :pkg="pkg.pkg" :zones="otherZones" :draft="form" picking @pick="(p) => form.points.push(p)" />
        </div>
        <p v-else class="note">De kaart is er nog niet. Open deze pagina met bereik.</p>
        <span class="small">{{ hint }} Zoom in voor een precieze lijn.</span>
        <div class="draw-actions">
          <span class="small mono">{{ form.points.length === 1 ? '1 punt' : `${form.points.length} punten` }}</span>
          <button class="add-link" :disabled="!form.points.length" @click="form.points.pop()">Laatste punt weg</button>
          <button class="add-link danger-link" :disabled="!form.points.length" @click="clearPoints">Opnieuw</button>
        </div>
      </div>
    </template>

    <template #footer>
      <p v-if="save.error.value" class="error-text" role="alert">{{ save.error.value }}</p>
      <button v-if="canSave" class="btn primary" :disabled="save.busy.value || !form.name.trim() || (!isNew && !zone)" @click="submit">Opslaan</button>
      <button v-if="!isNew && zone" class="btn link danger-link" @click="remove">Zone verwijderen</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.draw-map { height: clamp(280px, 50dvh, 560px); }
.draw-actions { display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
.draw-actions .add-link:disabled { opacity: .4; }
</style>
