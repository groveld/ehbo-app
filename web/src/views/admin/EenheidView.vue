<script setup lang="ts">
// 1.5 · EHBO-eenheid: vast (eigen EHBO-post) of mobiel (met optionele standplaats), leden en AED.
import { computed, reactive, ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { formatPhone, type UnitData, type UnitMobility } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useDirty } from '../../composables/useDirty.ts';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';

const props = defineProps<{ id: string }>();
const admin = useAdminStore();
const router = useRouter();
const save = useSave();

const isNew = computed(() => props.id === 'nieuw');
const unit = computed(() => admin.state?.units.find((u) => u.id === Number(props.id)) ?? null);
const MOBILITY: { value: UnitMobility; label: string }[] = [
  { value: 'te_voet', label: 'Te voet' }, { value: 'fiets', label: 'Fiets' }, { value: 'auto', label: 'Auto' }, { value: 'anders', label: 'Anders' },
];

const form = reactive<UnitData>({ name: '', kind: 'vast', mobility: null, postId: null, hasAed: false, members: [] });
const loaded = ref(false);
// Een nieuwe post, eenheid of loop is nog niet opgeslagen; een bestaande alleen als er iets gewijzigd is.
const { dirty, markClean } = useDirty(() => form);
const canSave = computed(() => isNew.value || dirty.value);
watchEffect(() => {
  if (loaded.value || !admin.state) return;
  if (unit.value) {
    Object.assign(form, unit.value, { members: unit.value.members.map((m) => ({ ...m, phone: formatPhone(m.phone) })) });
  } else {
    form.name = `Team ${admin.state.units.length + 1}`;
    form.members = [{ name: '', phone: '' }];
  }
  markClean();
  loaded.value = true;
});

// Vast: een EHBO-post; mobiel: elke post kan standplaats zijn.
const ehboPosts = computed(() => {
  const ehboType = admin.state?.postTypes.find((t) => t.key === 'ehbo')?.id;
  return admin.state?.posts.filter((p) => p.typeId === ehboType) ?? [];
});
const postChoices = computed(() => (form.kind === 'vast' ? ehboPosts.value : admin.state?.posts ?? []));
const selectedPost = computed(() => (form.postId !== null ? admin.postById.get(form.postId) : undefined));

function setKind(kind: UnitData['kind']) {
  form.kind = kind;
  if (kind === 'mobiel') form.mobility ??= 'fiets';
  // Een standplaats die geen EHBO-post is, kan niet de eigen post van een vaste eenheid zijn.
  if (kind === 'vast' && form.postId !== null && !ehboPosts.value.some((p) => p.id === form.postId)) form.postId = null;
}

async function submit() {
  const data: UnitData = {
    ...form,
    mobility: form.kind === 'mobiel' ? form.mobility : null,
    members: form.members.filter((m) => m.phone.trim()),
  };
  if (await save.run(() => admin.saveUnit(isNew.value ? null : Number(props.id), data))) router.push({ name: 'beheer-eenheden' });
}

async function remove() {
  if (!confirm(`${form.name} verwijderen? De leden krijgen dan geen oproepen meer.`)) return;
  if (await save.run(() => admin.deleteUnit(Number(props.id)))) router.push({ name: 'beheer-eenheden' });
}
</script>

<template>
  <AdminPage title="EHBO-eenheid" :eyebrow="isNew ? 'Nieuw' : form.name" :back="{ name: 'beheer-eenheden' }">
    <template #default="{ state }">
      <p v-if="!isNew && !unit" class="note warn">Deze eenheid bestaat niet (meer).</p>
      <template v-else>
        <div class="form-field">
          <label for="team-naam">Naam</label>
          <input id="team-naam" v-model="form.name" class="input" required>
        </div>

        <div class="form-field">
          <span class="section-label">Soort</span>
          <div class="choice-grid two">
            <button class="option tall" :aria-pressed="form.kind === 'vast'" @click="setKind('vast')">Vast<span class="hint">eigen EHBO-post</span></button>
            <button class="option tall" :aria-pressed="form.kind === 'mobiel'" @click="setKind('mobiel')">Mobiel<span class="hint">rijdt of loopt rond</span></button>
          </div>
          <div v-if="form.kind === 'mobiel'" class="choice-grid four">
            <button v-for="m in MOBILITY" :key="m.value" class="option" :aria-pressed="form.mobility === m.value" @click="form.mobility = m.value">{{ m.label }}</button>
          </div>
        </div>

        <div class="form-field">
          <label for="post">{{ form.kind === 'vast' ? 'EHBO-post' : 'Standplaats (optioneel)' }}</label>
          <select id="post" v-model="form.postId" class="input">
            <option :value="null">{{ form.kind === 'vast' ? 'Kies de EHBO-post' : 'Geen standplaats (niet op de kaart)' }}</option>
            <option v-for="p in postChoices" :key="p.id" :value="p.id">
              {{ p.name }}{{ p.km !== null ? ` · km ${p.km.toLocaleString('nl-NL')}` : '' }}
            </option>
          </select>
          <span v-if="form.kind === 'vast' && !ehboPosts.length" class="note warn">
            Er is nog geen EHBO-post. Voeg die eerst toe bij Posten, met soort "EHBO-post".
          </span>
          <span v-else-if="form.kind === 'mobiel' && selectedPost" class="small">
            Staat als klein kruisje bij deze post op de kaart. Het team kan onderweg zijn; de post houdt een oogje in het zeil.
          </span>
          <span v-else-if="form.kind === 'vast'" class="small">De eenheid zit op deze post; zo staat ze op de kaart.</span>
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
          <span class="badge heart"><Icon name="cross" :size="20" /></span>
          <span class="main"><span class="label">AED bij zich</span><span class="small">Voorrang bij "niet aanspreekbaar"</span></span>
          <button role="switch" class="switch" :aria-checked="form.hasAed" aria-label="AED bij zich" @click="form.hasAed = !form.hasAed" />
        </div>
        <span v-if="state.units.length === 0 && isNew" class="small">Een eenheid van één persoon kan ook.</span>
      </template>
    </template>

    <template #footer>
      <p v-if="save.error.value" class="error-text" role="alert">{{ save.error.value }}</p>
      <button v-if="canSave" class="btn primary" :disabled="save.busy.value || !form.name.trim() || (!isNew && !unit)" @click="submit">Opslaan</button>
      <button v-if="!isNew && unit" class="btn link danger-link" @click="remove">Eenheid verwijderen</button>
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
