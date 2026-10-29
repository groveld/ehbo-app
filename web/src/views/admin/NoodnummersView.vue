<script setup lang="ts">
// Beheer › Noodnummers: 112 staat vast; de rest (Spoedeisende Hulp, Huisartsenpost, …) zijn de escalatieknoppen.
import { ref } from 'vue';
import { formatPhone, type EmergencyNumber } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useDirty } from '../../composables/useDirty.ts';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';

const admin = useAdminStore();
const save = useSave();
const { dirty, markClean } = useDirty(() => draft.value);
const draft = ref<EmergencyNumber[] | null>(null);

const edit = () => {
  draft.value = admin.state!.emergencyNumbers.length
    ? admin.state!.emergencyNumbers.map((n) => ({ ...n, number: formatPhone(n.number) }))
    : [{ label: 'Spoedeisende Hulp', number: '' }, { label: 'Huisartsenpost', number: '' }];
  markClean();
};
async function submit() {
  const entries = draft.value!.filter((n) => n.label.trim() && n.number.trim());
  if (await save.run(() => admin.saveEmergencyNumbers(entries))) draft.value = null;
}
</script>

<template>
  <AdminPage title="Noodnummers" eyebrow="Beheer" :back="{ name: 'beheer' }">
    <template #action>
      <button v-if="!draft" class="add-link" @click="edit">Wijzigen</button>
    </template>

    <template #default="{ state }">
      <div v-if="!draft" class="list">
        <div class="list-row"><span class="main"><span class="title-line">112</span></span><span class="sub">vast</span></div>
        <div v-for="n in state.emergencyNumbers" :key="n.label" class="list-row">
          <span class="main"><span class="title-line">{{ n.label }}</span></span>
          <span class="sub mono">{{ formatPhone(n.number) }}</span>
        </div>
      </div>
      <template v-else>
        <div v-for="(n, i) in draft" :key="i" class="draft-head">
          <input v-model="n.label" class="input" aria-label="Omschrijving" placeholder="Bijv. Spoedeisende Hulp">
          <input v-model="n.number" class="input number" type="tel" inputmode="tel" aria-label="Nummer" placeholder="Nummer">
          <button class="icon-btn" aria-label="Nummer verwijderen" @click="draft.splice(i, 1)"><Icon name="trash" :size="20" /></button>
        </div>
        <button class="add-link" @click="draft.push({ label: '', number: '' })">+ Nummer toevoegen</button>
      </template>
    </template>

    <template v-if="draft" #footer>
      <p v-if="save.error.value" class="error-text" role="alert">{{ save.error.value }}</p>
      <!-- Opslaan alleen als er iets gewijzigd is; anders alleen terug. -->
      <div :class="{ 'row-2': dirty }">
        <button class="btn" @click="draft = null">{{ dirty ? 'Annuleren' : 'Klaar' }}</button>
        <button v-if="dirty" class="btn primary short" :disabled="save.busy.value" @click="submit">Opslaan</button>
      </div>
    </template>
  </AdminPage>
</template>

<style scoped>
.draft-head { display: flex; gap: 8px; align-items: center; }
.number { max-width: 140px; }
.btn.primary.short { height: 48px; }
</style>
