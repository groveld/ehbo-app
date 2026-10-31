<script setup lang="ts">
// 1.4 · EHBO-eenheden: overzicht.
import type { AdminUnit } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { useAdminStore } from '../../stores/admin.ts';

const admin = useAdminStore();
const MOBILITY = { te_voet: 'TE VOET', fiets: 'FIETS', auto: 'AUTO', anders: 'ANDERS' } as const;

function describe(u: AdminUnit) {
  const post = u.postId !== null ? admin.postById.get(u.postId) : undefined;
  const km = post?.km != null ? ` · km ${post.km.toLocaleString('nl-NL', { maximumFractionDigits: 1 })}` : '';
  const members = u.members.length === 1 ? '1 lid' : `${u.members.length} leden`;
  if (u.kind === 'vast') return post ? `${post.name}${km} · ${members}` : `Geen EHBO-post gekozen · ${members}`;
  return post ? `Standplaats: ${post.name} · ${members}` : 'Geen standplaats · niet op de kaart';
}
</script>

<template>
  <AdminPage title="EHBO-eenheden" eyebrow="Beheer" :back="{ name: 'beheer' }">
    <template #default="{ state }">
      <div v-if="state.units.length" class="stack gap-8">
        <RouterLink v-for="u in state.units" :key="u.id" :to="{ name: 'beheer-eenheid', params: { id: u.id } }" class="card unit">
          <span class="badge cross" :class="u.kind"><Icon name="ehbo" :size="22" /></span>
          <span class="main">
            <span class="title-line">
              {{ u.name }}
              <span class="tag">{{ u.kind === 'vast' ? 'VAST' : `MOBIEL · ${MOBILITY[u.mobility ?? 'anders']}` }}</span>
              <span v-if="u.hasAed" class="tag ok">AED</span>
            </span>
            <span class="sub" :class="{ warn: u.kind === 'vast' && u.postId === null }">{{ describe(u) }}</span>
          </span>
          <Icon name="forward" :size="18" />
        </RouterLink>
      </div>
      <p class="note info">
        AED-eenheden krijgen voorrang bij "niet aanspreekbaar". Vaste eenheden staan als EHBO-post op de kaart. Mobiele eenheden met standplaats staan als klein kruisje bij die post; zonder standplaats alleen in deze lijst.
      </p>
      <RouterLink :to="{ name: 'beheer-eenheid', params: { id: 'nieuw' } }" class="add-link">+ EHBO-eenheid toevoegen</RouterLink>
    </template>
  </AdminPage>
</template>

<style scoped>
.unit { display: flex; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; }
.cross { width: 40px; height: 40px; border-radius: 12px; background: var(--ok); color: #FFFFFF; }
.cross.mobiel { background: var(--ok-bg); color: var(--ok); }
.main { display: flex; flex-direction: column; gap: 2px; flex-grow: 1; min-width: 0; }
.title-line { font-size: 15px; font-weight: 700; }
.sub { font-size: 13px; color: var(--muted); }
.sub.warn { color: var(--warn); font-weight: 600; }
</style>
