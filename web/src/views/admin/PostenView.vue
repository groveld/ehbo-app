<script setup lang="ts">
// Lijst van posten (niet in het schermontwerp; zelfde opzet als 1.4 EHBO-eenheden).
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useAdminStore } from '../../stores/admin.ts';

const admin = useAdminStore();
const km = (value: number) => value.toLocaleString('nl-NL', { maximumFractionDigits: 1 });
</script>

<template>
  <AdminPage title="Posten" eyebrow="Beheer" :back="{ name: 'beheer' }">
    <template #default="{ state }">
      <div v-if="state.posts.length" class="list">
        <RouterLink v-for="p in state.posts" :key="p.id" :to="{ name: 'beheer-post', params: { id: p.id } }" class="list-row">
          <span class="badge letter" :style="{ background: admin.postTypeById.get(p.typeId)?.color }">{{ admin.postTypeById.get(p.typeId)?.letter }}</span>
          <span class="main">
            <span class="title-line">{{ p.name }}</span>
            <span class="sub">
              {{ [p.km !== null ? `km ${km(p.km)}` : null, p.contacts.length === 1 ? '1 contact' : `${p.contacts.length} contacten`].filter(Boolean).join(' · ') }}
            </span>
          </span>
          <span v-if="p.lat === null" class="tag warn">Geen locatie</span>
          <Icon name="forward" :size="18" />
        </RouterLink>
      </div>
      <p v-else class="note">Nog geen posten. Voeg ze toe ter plaatse, dan legt de app meteen de GPS-positie vast.</p>
      <RouterLink :to="{ name: 'beheer-post', params: { id: 'nieuw' } }" class="add-link">+ Post toevoegen</RouterLink>
    </template>
  </AdminPage>
</template>

<style scoped>
.letter { width: 40px; height: 40px; color: #FFFFFF; font-size: 15px; }
.tag { margin-left: 0; flex-shrink: 0; }
</style>
