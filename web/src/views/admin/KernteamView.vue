<script setup lang="ts">
// Beheer › Kernteam: functies met naam en nummer; de evenementcoördinator is het centrale aanspreekpunt.
import { ref } from 'vue';
import { formatPhone, type CoreTeamEntry } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';

const admin = useAdminStore();
const save = useSave();
const draft = ref<CoreTeamEntry[] | null>(null);

const edit = () => { draft.value = admin.state!.coreTeam.map((c) => ({ ...c, phone: c.phone ? formatPhone(c.phone) : '' })); };
async function submit() {
  const entries = draft.value!.filter((c) => c.function.trim()).map((c) => ({ ...c, phone: c.phone?.trim() || null }));
  if (await save.run(() => admin.saveCoreTeam(entries))) draft.value = null;
}
</script>

<template>
  <AdminPage title="Kernteam" eyebrow="Beheer" :back="{ name: 'beheer' }">
    <template #action>
      <button v-if="!draft" class="add-link" @click="edit">Wijzigen</button>
    </template>

    <template #default="{ state }">
      <div v-if="!draft" class="list">
        <div v-for="c in state.coreTeam" :key="c.function" class="list-row">
          <span class="main">
            <span class="title-line">{{ c.function }}<template v-if="c.name"> · <span class="name">{{ c.name }}</span></template></span>
            <span class="sub" :class="{ mono: c.phone }">{{ c.phone ? formatPhone(c.phone) : 'Nog niet ingevuld' }}</span>
          </span>
          <span v-if="c.isCoordinator" class="tag ok">centraal</span>
        </div>
      </div>
      <template v-else>
        <div v-for="(c, i) in draft" :key="i" class="card stack gap-8">
          <div class="draft-head">
            <input v-model="c.function" class="input" aria-label="Functie" placeholder="Functie">
            <button v-if="!c.isCoordinator" class="icon-btn" aria-label="Functie verwijderen" @click="draft.splice(i, 1)"><Icon name="trash" :size="20" /></button>
          </div>
          <div class="row-2">
            <input v-model="c.name" class="input" aria-label="Naam" placeholder="Naam">
            <input v-model="c.phone" class="input" type="tel" inputmode="tel" aria-label="Telefoonnummer" placeholder="+31 6 …">
          </div>
          <span v-if="c.isCoordinator" class="small">Centraal aanspreekpunt: ontvangt alle verzoeken en een kopie van elke EHBO-oproep.</span>
        </div>
        <button class="add-link" @click="draft.push({ function: '', name: '', phone: '', isCoordinator: false })">+ Functie toevoegen</button>
      </template>
    </template>

    <template v-if="draft" #footer>
      <p v-if="save.error.value" class="error-text" role="alert">{{ save.error.value }}</p>
      <div class="row-2">
        <button class="btn" @click="draft = null">Annuleren</button>
        <button class="btn primary short" :disabled="save.busy.value" @click="submit">Opslaan</button>
      </div>
    </template>
  </AdminPage>
</template>

<style scoped>
.name { font-weight: 400; }
.draft-head { display: flex; gap: 8px; align-items: center; }
.btn.primary.short { height: 48px; }
</style>
