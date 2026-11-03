<script setup lang="ts">
// Eerder vandaag: de afgeronde meldingen en aanvragen van een post, vanaf het poststartscherm. Tik voor het logboek.
import { computed } from 'vue';
import { REQUEST_KINDS, requestDetailLabel } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import { clock, incidentSummary } from '../incidents.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();

const postId = computed(() => Number(props.id));
const post = computed(() => store.postById.get(postId.value));
/** Nieuwste eerst. */
const history = computed(() => [
  ...live.incidents.filter((i) => i.postId === postId.value && !i.offPost && (i.status === 'afgerond' || i.status === 'ingetrokken')).map((i) => ({
    key: `i${i.id}`, at: i.reportedAt, text: `EHBO · ${incidentSummary(i)}`, done: i.status === 'afgerond', state: i.status === 'afgerond' ? 'afgerond' : 'ingetrokken',
    to: { name: 'post-melding', params: { postId: postId.value, id: i.id } },
  })),
  ...live.requests.filter((r) => r.postId === postId.value && (r.status === 'afgehandeld' || r.status === 'ingetrokken')).map((r) => ({
    key: `r${r.id}`, at: r.createdAt, text: [REQUEST_KINDS[r.kind].label, requestDetailLabel(r.kind, r.detail)].filter(Boolean).join(' · '), done: r.status === 'afgehandeld',
    state: r.status === 'afgehandeld' ? 'afgehandeld' : 'ingetrokken', to: { name: 'post-aanvraag', params: { postId: postId.value, id: r.id } },
  })),
].sort((a, b) => b.at.localeCompare(a.at)));
</script>

<template>
  <main class="screen tight">
    <header class="header">
      <RouterLink :to="{ name: 'post-home', params: { id } }" aria-label="Terug" class="icon-btn"><Icon name="back" /></RouterLink>
      <div class="stack">
        <h1 class="heading">Eerder vandaag</h1>
        <span v-if="post" class="small">{{ post.name }}</span>
      </div>
    </header>

    <div v-if="history.length" class="list">
      <RouterLink v-for="h in history" :key="h.key" :to="h.to" class="list-row earlier">
        <span class="main">
          <span class="title-line">{{ h.text }}</span>
          <span class="sub">{{ clock(h.at) }}</span>
        </span>
        <span class="tag" :class="{ ok: h.done }">{{ h.state }}</span>
        <Icon name="forward" :size="16" />
      </RouterLink>
    </div>
    <p v-else class="note">Nog niets. Wat deze locatie vraagt en afgerond is, staat hier.</p>
  </main>
</template>

<style scoped>
.header { display: flex; align-items: center; gap: 4px; padding: 14px 0 10px; margin-left: -4px; }
.heading { font-size: 20px; font-weight: 700; line-height: 1.2; }
.earlier { min-height: 56px; color: var(--ink); text-decoration: none; }
</style>
