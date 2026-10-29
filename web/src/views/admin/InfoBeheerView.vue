<script setup lang="ts">
// Info & voorwaarden aanpassen (de tekst van 2.6). Zonder eigen tekst toont de app de standaardtekst.
import { reactive, ref, watchEffect } from 'vue';
import { DEFAULT_INFO, INFO_SECTIONS_MAX, type InfoSection } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useDirty } from '../../composables/useDirty.ts';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';

const admin = useAdminStore();
const form = reactive<{ sections: InfoSection[]; policy: string; contact: string }>({ sections: [], policy: '', contact: '' });
const loaded = ref(false);
const saved = ref(false);
const { busy, error, run } = useSave();
const { dirty, markClean } = useDirty(() => form);

watchEffect(() => {
  if (loaded.value || !admin.state) return;
  const info = admin.state.info;
  form.sections = (info.sections ?? DEFAULT_INFO).map((s) => ({ ...s }));
  form.policy = info.policy ?? '';
  form.contact = info.contact ?? '';
  markClean();
  loaded.value = true;
});

const add = () => form.sections.push({ title: '', body: '' });
const remove = (i: number) => form.sections.splice(i, 1);
const move = (i: number, delta: number) => {
  const [section] = form.sections.splice(i, 1);
  form.sections.splice(i + delta, 0, section!);
};

async function save() {
  saved.value = false;
  saved.value = await run(() => admin.saveInfo({ sections: form.sections, policy: form.policy || null, contact: form.contact || null }));
  if (saved.value) markClean();
}
async function reset() {
  if (!confirm('Terug naar de standaardtekst? Je eigen teksten gaan verloren.')) return;
  if (await run(() => admin.saveInfo({ sections: null, policy: form.policy || null, contact: form.contact || null }))) {
    form.sections = DEFAULT_INFO.map((s) => ({ ...s }));
    markClean();
    saved.value = true;
  }
}
</script>

<template>
  <AdminPage title="Info & voorwaarden" eyebrow="Beheer" :back="{ name: 'beheer' }">
    <template #default="{ state }">
      <p class="note info">
        Iedereen kan deze pagina lezen; medewerkers bevestigen hem eenmalig bij de eerste aanmelding.
        In de tekst wordt <strong>{evenement}</strong> de naam van het evenement, <strong>{beleid}</strong> en <strong>{contact}</strong> wat je hieronder invult.
      </p>

      <div class="form-field">
        <label for="info-beleid">Bewaren volgens ({beleid})</label>
        <input id="info-beleid" v-model="form.policy" class="input" maxlength="200" placeholder="het verwijderplan van de organisatie">
      </div>
      <div class="form-field">
        <label for="info-contact">Contact voor vragen ({contact})</label>
        <input id="info-contact" v-model="form.contact" class="input" maxlength="200" placeholder="de evenementcoördinator">
      </div>

      <section class="stack gap-10">
        <span class="section-title">Onderdelen<span v-if="!state.info.sections" class="tag">standaardtekst</span></span>
        <div v-for="(s, i) in form.sections" :key="i" class="card stack gap-8">
          <div class="section-head">
            <input v-model="s.title" class="input grow" maxlength="80" :aria-label="`Kop van onderdeel ${i + 1}`" placeholder="Kop">
            <button class="icon-btn" :disabled="i === 0" aria-label="Omhoog" @click="move(i, -1)"><Icon name="back" :size="18" class="up" /></button>
            <button class="icon-btn" :disabled="i === form.sections.length - 1" aria-label="Omlaag" @click="move(i, 1)"><Icon name="forward" :size="18" class="down" /></button>
            <button class="icon-btn" aria-label="Onderdeel verwijderen" @click="remove(i)"><Icon name="trash" :size="18" /></button>
          </div>
          <textarea v-model="s.body" class="input" rows="3" maxlength="2000" :aria-label="`Tekst van onderdeel ${i + 1}`" />
        </div>
        <button v-if="form.sections.length < INFO_SECTIONS_MAX" class="add-link" @click="add">+ Onderdeel toevoegen</button>
        <button v-if="state.info.sections" class="add-link reset" :disabled="busy" @click="reset">Terug naar de standaardtekst</button>
      </section>

      <RouterLink :to="{ name: 'info' }" class="add-link">Bekijk de info-pagina</RouterLink>
    </template>

    <!-- Opslaan alleen als er iets gewijzigd is. -->
    <template v-if="dirty || error || saved" #footer>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <p v-else-if="saved && !dirty" class="small" role="status">Opgeslagen.</p>
      <button v-if="dirty" class="btn primary" :disabled="busy" @click="save">Opslaan</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.section-head { display: flex; align-items: center; gap: 2px; }
.section-head .input { min-width: 0; font-weight: 600; }
.up { transform: rotate(90deg); }
.down { transform: rotate(90deg); }
.reset { color: var(--muted); }
</style>
