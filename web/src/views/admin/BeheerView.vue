<script setup lang="ts">
// 1.2 · Beheerders, kernteam, noodnummers, en de weg naar evenement, posten, EHBO-eenheden en het rapport.
import { ref } from 'vue';
import { formatPhone, type CoreTeamEntry, type EmergencyNumber } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';
import { useSessionStore } from '../../stores/session.ts';

const admin = useAdminStore();
const session = useSessionStore();

// Beheerders
const newAdmin = ref('');
const admins = useSave();
async function addAdmin() {
  if (await admins.run(() => admin.addAdmin({ phone: newAdmin.value }))) newAdmin.value = '';
}
async function removeAdmin(phone: string, name: string) {
  if (confirm(`${name || formatPhone(phone)} is dan geen beheerder meer. Doorgaan?`)) await admins.run(() => admin.removeAdmin(phone));
}

// Kernteam
const team = useSave();
const teamDraft = ref<CoreTeamEntry[] | null>(null);
const editTeam = () => { teamDraft.value = admin.state!.coreTeam.map((c) => ({ ...c, phone: c.phone ? formatPhone(c.phone) : '' })); };
async function saveTeam() {
  const entries = teamDraft.value!.filter((c) => c.function.trim()).map((c) => ({ ...c, phone: c.phone?.trim() || null }));
  if (await team.run(() => admin.saveCoreTeam(entries))) teamDraft.value = null;
}

// Noodnummers
const numbers = useSave();
const numbersDraft = ref<EmergencyNumber[] | null>(null);
const editNumbers = () => {
  numbersDraft.value = admin.state!.emergencyNumbers.length
    ? admin.state!.emergencyNumbers.map((n) => ({ ...n, number: formatPhone(n.number) }))
    : [{ label: 'Spoedeisende Hulp', number: '' }, { label: 'Huisartsenpost', number: '' }];
};
async function saveNumbers() {
  const entries = numbersDraft.value!.filter((n) => n.label.trim() && n.number.trim());
  if (await numbers.run(() => admin.saveEmergencyNumbers(entries))) numbersDraft.value = null;
}
</script>

<template>
  <AdminPage title="Beheer" eyebrow="Alleen zichtbaar voor beheerders" :back="{ name: 'menu' }">
    <template #default="{ state }">
      <nav class="list">
        <RouterLink :to="{ name: 'beheer-evenement' }" class="list-row">
          <Icon name="settings" :size="20" />
          <span class="main"><span class="title-line">Evenement</span><span class="sub">{{ state.event.name }} · {{ state.runs.length }} lopen</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'beheer-posten' }" class="list-row">
          <Icon name="pin" :size="20" />
          <span class="main"><span class="title-line">Posten</span><span class="sub">{{ state.posts.length }} posten</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'beheer-eenheden' }" class="list-row">
          <Icon name="cross" :size="20" />
          <span class="main"><span class="title-line">EHBO-eenheden</span><span class="sub">{{ state.units.length }} eenheden</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'beheer-info' }" class="list-row">
          <Icon name="info" :size="20" />
          <span class="main">
            <span class="title-line">Info &amp; voorwaarden</span>
            <span class="sub">{{ state.info.sections ? 'Eigen tekst' : 'Standaardtekst' }}</span>
          </span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'beheer-rapport' }" class="list-row">
          <Icon name="list" :size="20" />
          <span class="main">
            <span class="title-line">Rapport en testmodus<span v-if="state.testMode" class="tag warn">testmodus aan</span></span>
            <span class="sub">Incidenten, PDF en CSV; proefoproepen voor het evenement</span>
          </span>
          <Icon name="forward" :size="18" />
        </RouterLink>
      </nav>

      <section class="stack gap-8">
        <h2 class="section-title">Beheerders</h2>
        <div class="list">
          <div v-for="a in state.admins" :key="a.phone" class="list-row">
            <span class="main">
              <span class="title-line">{{ a.name || 'Naam onbekend' }}<span v-if="a.phone === session.me?.phone" class="tag">jij</span></span>
              <span class="sub mono">{{ formatPhone(a.phone) }}</span>
            </span>
            <button v-if="a.phone !== session.me?.phone" class="icon-btn" aria-label="Beheerder verwijderen" @click="removeAdmin(a.phone, a.name)">
              <Icon name="trash" :size="20" />
            </button>
          </div>
        </div>
        <form class="add-row" @submit.prevent="addAdmin">
          <input v-model="newAdmin" class="input" type="tel" inputmode="tel" aria-label="Telefoonnummer nieuwe beheerder" placeholder="+31 6 … toevoegen">
          <button class="btn add-btn" :disabled="admins.busy.value || !newAdmin.trim()">Toevoegen</button>
        </form>
        <p v-if="admins.error.value" class="error-text" role="alert">{{ admins.error.value }}</p>
      </section>

      <section class="stack gap-8">
        <div class="section-head">
          <h2 class="section-title">Kernteam</h2>
          <button v-if="!teamDraft" class="add-link" @click="editTeam">Wijzigen</button>
        </div>
        <div v-if="!teamDraft" class="list">
          <div v-for="c in state.coreTeam" :key="c.function" class="list-row">
            <span class="main">
              <span class="title-line">{{ c.function }}<template v-if="c.name"> · <span class="name">{{ c.name }}</span></template></span>
              <span class="sub" :class="{ mono: c.phone }">{{ c.phone ? formatPhone(c.phone) : 'Nog niet ingevuld' }}</span>
            </span>
            <span v-if="c.isCoordinator" class="tag ok">centraal</span>
          </div>
        </div>
        <template v-else>
          <div v-for="(c, i) in teamDraft" :key="i" class="card stack gap-8">
            <div class="draft-head">
              <input v-model="c.function" class="input" aria-label="Functie" placeholder="Functie">
              <button v-if="!c.isCoordinator" class="icon-btn" aria-label="Functie verwijderen" @click="teamDraft.splice(i, 1)"><Icon name="trash" :size="20" /></button>
            </div>
            <div class="row-2">
              <input v-model="c.name" class="input" aria-label="Naam" placeholder="Naam">
              <input v-model="c.phone" class="input" type="tel" inputmode="tel" aria-label="Telefoonnummer" placeholder="+31 6 …">
            </div>
            <span v-if="c.isCoordinator" class="small">Centraal aanspreekpunt: ontvangt alle verzoeken en een kopie van elke EHBO-oproep.</span>
          </div>
          <button class="add-link" @click="teamDraft.push({ function: '', name: '', phone: '', isCoordinator: false })">+ Functie toevoegen</button>
          <p v-if="team.error.value" class="error-text" role="alert">{{ team.error.value }}</p>
          <div class="row-2">
            <button class="btn" @click="teamDraft = null">Annuleren</button>
            <button class="btn primary short" :disabled="team.busy.value" @click="saveTeam">Opslaan</button>
          </div>
        </template>
      </section>

      <section class="stack gap-8">
        <div class="section-head">
          <h2 class="section-title">Noodnummers bij escalatie</h2>
          <button v-if="!numbersDraft" class="add-link" @click="editNumbers">Wijzigen</button>
        </div>
        <div v-if="!numbersDraft" class="list">
          <div class="list-row"><span class="main"><span class="title-line">112</span></span><span class="sub">vast</span></div>
          <div v-for="n in state.emergencyNumbers" :key="n.label" class="list-row">
            <span class="main"><span class="title-line">{{ n.label }}</span></span>
            <span class="sub mono">{{ formatPhone(n.number) }}</span>
          </div>
        </div>
        <template v-else>
          <div v-for="(n, i) in numbersDraft" :key="i" class="draft-head">
            <input v-model="n.label" class="input" aria-label="Omschrijving" placeholder="Bijv. Spoedeisende Hulp">
            <input v-model="n.number" class="input number" type="tel" inputmode="tel" aria-label="Nummer" placeholder="Nummer">
            <button class="icon-btn" aria-label="Nummer verwijderen" @click="numbersDraft.splice(i, 1)"><Icon name="trash" :size="20" /></button>
          </div>
          <button class="add-link" @click="numbersDraft.push({ label: '', number: '' })">+ Nummer toevoegen</button>
          <p v-if="numbers.error.value" class="error-text" role="alert">{{ numbers.error.value }}</p>
          <div class="row-2">
            <button class="btn" @click="numbersDraft = null">Annuleren</button>
            <button class="btn primary short" :disabled="numbers.busy.value" @click="saveNumbers">Opslaan</button>
          </div>
        </template>
      </section>
    </template>
  </AdminPage>
</template>

<style scoped>
.name { font-weight: 400; }
.add-row { display: flex; gap: 8px; }
.add-btn { width: auto; flex-shrink: 0; padding: 0 16px; height: 44px; }
.section-head { display: flex; align-items: center; justify-content: space-between; }
.draft-head { display: flex; gap: 8px; align-items: center; }
.number { max-width: 140px; }
.btn.primary.short { height: 48px; }
</style>
