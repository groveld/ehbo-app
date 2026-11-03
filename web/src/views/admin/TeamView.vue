<script setup lang="ts">
// 1.5 · EHBO-eenheid: vast (eigen EHBO-post) of mobiel (met optionele standplaats), leden en AED.
import { computed, reactive, ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { formatPhone, type TeamData, type TeamMobility } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useDirty } from '../../composables/useDirty.ts';
import { confirmDialog } from '../../composables/useDialog.ts';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';

const props = defineProps<{ id: string }>();
const admin = useAdminStore();
const router = useRouter();
const save = useSave();

const isNew = computed(() => props.id === 'nieuw');
const team = computed(() => admin.state?.teams.find((u) => u.id === Number(props.id)) ?? null);
const MOBILITY: { value: TeamMobility; label: string }[] = [
  { value: 'on_foot', label: 'Te voet' }, { value: 'bike', label: 'Fiets' }, { value: 'car', label: 'Auto' }, { value: 'other', label: 'Anders' },
];

const form = reactive<TeamData>({ name: '', kind: 'fixed', mobility: null, locationId: null, hasAed: false, timeFrom: null, timeTo: null, members: [] });
const loaded = ref(false);
// Een nieuwe post, eenheid of loop is nog niet opgeslagen; een bestaande alleen als er iets gewijzigd is.
const { dirty, markClean } = useDirty(() => form);
const canSave = computed(() => isNew.value || dirty.value);
watchEffect(() => {
  if (loaded.value || !admin.state) return;
  if (team.value) {
    Object.assign(form, team.value, { members: team.value.members.map((m) => ({ ...m, phone: formatPhone(m.phone) })) });
  } else {
    form.name = `Team ${admin.state.teams.length + 1}`;
    form.members = [{ name: '', phone: '' }];
  }
  markClean();
  loaded.value = true;
});

// Vast: een EHBO-post; mobiel: elke post kan standplaats zijn.
const ehboLocations = computed(() => {
  const ehboType = admin.state?.functionTypes.find((t) => t.key === 'first_aid')?.id;
  return admin.state?.locations.filter((p) => ehboType !== undefined && p.functionIds.includes(ehboType)) ?? [];
});
const locationChoices = computed(() => (form.kind === 'fixed' ? ehboLocations.value : admin.state?.locations ?? []));
const selectedLocation = computed(() => (form.locationId !== null ? admin.locationById.get(form.locationId) : undefined));

function setKind(kind: TeamData['kind']) {
  form.kind = kind;
  if (kind === 'mobile') form.mobility ??= 'bike';
  // Een standplaats die geen EHBO-post is, kan niet de eigen post van een vaste eenheid zijn.
  if (kind === 'fixed' && form.locationId !== null && !ehboLocations.value.some((p) => p.id === form.locationId)) form.locationId = null;
}

async function submit() {
  const data: TeamData = {
    ...form,
    mobility: form.kind === 'mobile' ? form.mobility : null,
    timeFrom: form.timeFrom || null,
    timeTo: form.timeTo || null,
    members: form.members.filter((m) => m.phone.trim()),
  };
  if (await save.run(() => admin.saveTeam(isNew.value ? null : Number(props.id), data))) router.push({ name: 'admin-teams' });
}

async function remove() {
  if (!await confirmDialog({ title: `${form.name} verwijderen?`, text: 'De leden krijgen dan geen oproepen meer.', confirm: 'Verwijderen', tone: 'danger' })) return;
  if (await save.run(() => admin.deleteTeam(Number(props.id)))) router.push({ name: 'admin-teams' });
}
</script>

<template>
  <AdminPage title="EHBO-eenheid" :eyebrow="isNew ? 'Nieuw' : form.name" :back="{ name: 'admin-teams' }">
    <template #default="{ state }">
      <p v-if="!isNew && !team" class="note warn">Deze eenheid bestaat niet (meer).</p>
      <template v-else>
        <div class="form-field">
          <label for="team-naam">Naam</label>
          <input id="team-naam" v-model="form.name" class="input" required>
        </div>

        <div class="form-field">
          <span class="section-label">Soort</span>
          <div class="choice-grid two">
            <button class="option tall" :aria-pressed="form.kind === 'fixed'" @click="setKind('fixed')">Vast<span class="hint">eigen EHBO-post</span></button>
            <button class="option tall" :aria-pressed="form.kind === 'mobile'" @click="setKind('mobile')">Mobiel<span class="hint">rijdt of loopt rond</span></button>
          </div>
          <div v-if="form.kind === 'mobile'" class="choice-grid four">
            <button v-for="m in MOBILITY" :key="m.value" class="option" :aria-pressed="form.mobility === m.value" @click="form.mobility = m.value">{{ m.label }}</button>
          </div>
        </div>

        <div class="form-field">
          <label for="post">{{ form.kind === 'fixed' ? 'EHBO-post' : 'Standplaats (optioneel)' }}</label>
          <select id="post" v-model="form.locationId" class="input">
            <option :value="null">{{ form.kind === 'fixed' ? 'Kies de EHBO-post' : 'Geen standplaats (niet op de kaart)' }}</option>
            <option v-for="p in locationChoices" :key="p.id" :value="p.id">
              {{ p.name }}{{ p.km !== null ? ` · km ${p.km.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}` : '' }}
            </option>
          </select>
          <span v-if="form.kind === 'fixed' && !ehboLocations.length" class="note warn">
            Er is nog geen EHBO-post. Voeg die eerst toe bij Posten, met soort "EHBO-post".
          </span>
          <span v-else-if="form.kind === 'mobile' && selectedLocation" class="small">
            Staat als klein kruisje bij deze post op de kaart. Het team kan onderweg zijn; de post houdt een oogje in het zeil.
          </span>
          <span v-else-if="form.kind === 'fixed'" class="small">De eenheid zit op deze locatie; zo staat ze op de kaart.</span>
        </div>

        <section class="stack gap-8">
          <span class="section-label">Leden</span>
          <div v-for="(m, i) in form.members" :key="i" class="member">
            <input v-model="m.name" class="input" aria-label="Naam lid" placeholder="Naam">
            <input v-model="m.phone" class="input" type="tel" inputmode="tel" aria-label="Telefoon lid" placeholder="+31 6 …">
            <button class="icon-btn" aria-label="Lid verwijderen" @click="form.members.splice(i, 1)"><Icon name="trash" :size="20" /></button>
          </div>
          <button class="add-link" @click="form.members.push({ name: '', phone: '' })">+ Lid toevoegen</button>
        </section>

        <div class="card aed">
        <div class="row-2">
          <div class="form-field">
            <label for="dienst-van">Dienst vanaf</label>
            <input id="dienst-van" v-model="form.timeFrom" class="input" type="time">
          </div>
          <div class="form-field">
            <label for="dienst-tot">Tot</label>
            <input id="dienst-tot" v-model="form.timeTo" class="input" type="time">
          </div>
        </div>
        <p class="small">Oproepen gaan gewoon naar wie beschikbaar is. Na de eindtijd gaat de eenheid vanzelf uit dienst, na een waarschuwing.</p>

          <span class="badge heart"><Icon name="ehbo" :size="20" /></span>
          <span class="main"><span class="label">AED bij zich</span><span class="small">Voorrang bij "niet aanspreekbaar"</span></span>
          <button role="switch" class="switch" :aria-checked="form.hasAed" aria-label="AED bij zich" @click="form.hasAed = !form.hasAed" />
        </div>
        <span v-if="state.teams.length === 0 && isNew" class="small">Een eenheid van één persoon kan ook.</span>
      </template>
    </template>

    <template #footer>
      <p v-if="save.error.value" class="error-text" role="alert">{{ save.error.value }}</p>
      <button v-if="canSave" class="btn primary" :disabled="save.busy.value || !form.name.trim() || (!isNew && !team)" @click="submit">Opslaan</button>
      <button v-if="!isNew && team" class="btn link danger-link" @click="remove">Eenheid verwijderen</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.option.tall { min-height: 56px; border-radius: 12px; }
.member { display: grid; grid-template-columns: 1fr 1fr 44px; gap: 8px; align-items: center; }
.aed { display: flex; align-items: center; gap: 12px; }
.heart { width: 40px; height: 40px; border-radius: 12px; background: #F8DEDC; color: var(--danger); }
.main { display: flex; flex-direction: column; gap: 1px; flex-grow: 1; }
.label { font-size: 15px; font-weight: 600; }
select.input { appearance: auto; }
</style>
