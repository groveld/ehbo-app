<script setup lang="ts">
// Beheer › Beheerders: wie het evenement mag inrichten. Je eigen nummer kun je niet verwijderen.
import { ref } from 'vue';
import { formatPhone } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';
import { useSessionStore } from '../../stores/session.ts';

const admin = useAdminStore();
const session = useSessionStore();
const save = useSave();
const editing = ref(false);
const newAdmin = ref('');

async function add() {
  if (await save.run(() => admin.addAdmin({ phone: newAdmin.value }))) newAdmin.value = '';
}
async function remove(phone: string, name: string) {
  if (confirm(`${name || formatPhone(phone)} is dan geen beheerder meer. Doorgaan?`)) await save.run(() => admin.removeAdmin(phone));
}
function done() {
  editing.value = false;
  newAdmin.value = '';
}
</script>

<template>
  <AdminPage title="Beheerders" eyebrow="Beheer" :back="{ name: 'beheer' }">
    <template #action>
      <button v-if="!editing" class="add-link" @click="editing = true">Wijzigen</button>
    </template>

    <template #default="{ state }">
      <div class="list">
        <div v-for="a in state.admins" :key="a.phone" class="list-row">
          <span class="main">
            <span class="title-line">{{ a.name || 'Naam onbekend' }}<span v-if="a.phone === session.me?.phone" class="tag">jij</span></span>
            <span class="sub mono">{{ formatPhone(a.phone) }}</span>
          </span>
          <button v-if="editing && a.phone !== session.me?.phone" class="icon-btn" aria-label="Beheerder verwijderen" @click="remove(a.phone, a.name)">
            <Icon name="trash" :size="20" />
          </button>
        </div>
      </div>
      <form v-if="editing" class="add-row" @submit.prevent="add">
        <input v-model="newAdmin" class="input" type="tel" inputmode="tel" aria-label="Telefoonnummer nieuwe beheerder" placeholder="+31 6 …">
        <button class="btn add-btn" :disabled="save.busy.value || !newAdmin.trim()">Toevoegen</button>
      </form>
      <p v-if="save.error.value" class="error-text" role="alert">{{ save.error.value }}</p>
    </template>

    <template v-if="editing" #footer>
      <button class="btn" @click="done">Klaar</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.add-row { display: flex; gap: 8px; }
.add-btn { width: auto; flex-shrink: 0; padding: 0 16px; height: 44px; }
</style>
