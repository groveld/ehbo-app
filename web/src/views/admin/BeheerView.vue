<script setup lang="ts">
// 1.2 · Beheer: één lijst met de onderdelen; elk onderdeel heeft een eigen pagina.
import type { AdminState } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';

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
        <RouterLink :to="{ name: 'beheer-kernteam' }" class="list-row">
          <Icon name="people" :size="20" />
          <span class="main"><span class="title-line">Kernteam</span><span class="sub">{{ teamSummary(state) }}</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'beheer-noodnummers' }" class="list-row">
          <Icon name="phone" :size="20" />
          <span class="main"><span class="title-line">Noodnummers</span><span class="sub">{{ ['112', ...state.emergencyNumbers.map((n) => n.label)].join(', ') }}</span></span>
          <Icon name="forward" :size="18" />
        </RouterLink>
        <RouterLink :to="{ name: 'beheer-beheerders' }" class="list-row">
          <Icon name="personAdd" :size="20" />
          <span class="main"><span class="title-line">Beheerders</span><span class="sub">{{ state.admins.length }} {{ state.admins.length === 1 ? 'beheerder' : 'beheerders' }}</span></span>
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
    </template>
  </AdminPage>
</template>
