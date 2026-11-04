<script setup lang="ts">
// 1.2 · Beheer: één lijst met de onderdelen; elk onderdeel heeft een eigen pagina.
import type { AdminState } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';

/** Everyone with a number somewhere: locations, teams, core team and admins. */
const peopleCount = (state: AdminState) => new Set([
  ...state.locations.flatMap((p) => p.contacts.map((c) => c.phone)),
  ...state.teams.flatMap((u) => u.members.map((m) => m.phone)),
  ...state.coreTeam.flatMap((c) => (c.phone ? [c.phone] : [])),
  ...state.admins.map((a) => a.phone),
]).size;

/** "5 functies · coördinator: Cor" */
function teamSummary(state: AdminState) {
  const coordinator = state.coreTeam.find((c) => c.isCoordinator);
  return [`${state.coreTeam.length} functies`, coordinator?.name ? `coördinator: ${coordinator.name}` : null].filter(Boolean).join(' · ');
}
</script>

<template>
  <AdminPage title="Beheer" :back="{ name: 'menu' }">
    <template #default="{ state }">
      <nav class="list">
        <RouterLink :to="{ name: 'admin-event' }" class="list-row">
          <Icon name="settings" :size="20" />
          <span class="main"><span class="title-line">Evenement</span><span class="sub">{{ state.event.name }} · {{ state.runs.length }} lopen</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-locations' }" class="list-row">
          <Icon name="pin" :size="20" />
          <span class="main"><span class="title-line">Locaties</span><span class="sub">{{ state.locations.length }} locaties</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-zones' }" class="list-row">
          <Icon name="map" :size="20" />
          <span class="main"><span class="title-line">Zones</span><span class="sub">{{ state.zones.length === 1 ? '1 zone' : `${state.zones.length} zones` }} · parkeren, eten en drinken</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-teams' }" class="list-row">
          <Icon name="ehbo" :size="20" />
          <span class="main"><span class="title-line">EHBO-eenheden</span><span class="sub">{{ state.teams.length }} eenheden</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-people' }" class="list-row">
          <Icon name="people" :size="20" />
          <span class="main"><span class="title-line">Mensen</span><span class="sub">{{ peopleCount(state) }} mensen · namen, nummers en waar ze staan</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-core-team' }" class="list-row">
          <Icon name="people" :size="20" />
          <span class="main"><span class="title-line">Kernteam</span><span class="sub">{{ teamSummary(state) }}</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-emergency-numbers' }" class="list-row">
          <Icon name="phone" :size="20" />
          <span class="main"><span class="title-line">Noodnummers</span><span class="sub">{{ ['112', ...state.emergencyNumbers.map((n) => n.label)].join(', ') }}</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-admins' }" class="list-row">
          <Icon name="personAdd" :size="20" />
          <span class="main"><span class="title-line">Beheerders</span><span class="sub">{{ state.admins.length }} {{ state.admins.length === 1 ? 'beheerder' : 'beheerders' }}</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-import' }" class="list-row">
          <Icon name="download" :size="20" />
          <span class="main"><span class="title-line">Importeren en exporteren</span><span class="sub">Locaties, mensen en eenheden in Excel voorbereiden</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-info' }" class="list-row">
          <Icon name="info" :size="20" />
          <span class="main">
            <span class="title-line">Info &amp; voorwaarden</span>
            <span class="sub">{{ state.info.sections ? 'Eigen tekst' : 'Standaardtekst' }}</span>
          </span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'admin-report' }" class="list-row">
          <Icon name="list" :size="20" />
          <span class="main">
            <span class="title-line">Rapport en testmodus<span v-if="state.testMode" class="tag warn">testmodus aan</span></span>
            <span class="sub">Incidenten, PDF en CSV; proefoproepen voor het evenement</span>
          </span>
          <Icon name="forward" :size="18" />
        </RouterLink>
      </nav>
    </template>
  </AdminPage>
</template>
