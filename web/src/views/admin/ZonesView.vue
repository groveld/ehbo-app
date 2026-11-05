<script setup lang="ts">
// Zones (#172): where participants can park, eat and drink. Same layout as the list of locations.
import { ZONE_KINDS } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import ZoneBadge from '../../components/ZoneBadge.vue';
</script>

<template>
  <AdminPage title="Zones" eyebrow="Beheer" :back="{ name: 'admin' }">
    <template #default="{ state }">
      <div v-if="state.zones.length" class="list">
        <RouterLink v-for="z in state.zones" :key="z.id" :to="{ name: 'admin-zone', params: { id: z.id } }" class="list-row">
          <ZoneBadge :kind="z.kind" />
          <span class="main">
            <span class="title-line">{{ z.name }}</span>
            <span class="sub">{{ [ZONE_KINDS[z.kind].label, z.note].filter(Boolean).join(' · ') }}</span>
          </span>
          <Icon name="forward" :size="18" />
        </RouterLink>
      </div>
      <p v-else class="note">Nog geen zones. Teken waar deelnemers kunnen parkeren of eten.</p>
      <RouterLink :to="{ name: 'admin-zone', params: { id: 'nieuw' } }" class="add-link">+ Zone toevoegen</RouterLink>
    </template>
  </AdminPage>
</template>
