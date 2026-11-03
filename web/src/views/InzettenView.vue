<script setup lang="ts">
// Mijn inzetten: de afgeronde en ingetrokken oproepen van je EHBO-eenheid, vanaf het EHBO-scherm. Tik op een inzet voor de melding.
import { computed } from 'vue';
import Icon from '../components/Icon.vue';
import { clock, incidentSummary, myDeployments, teamOf } from '../incidents.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const store = usePackageStore();
const live = useLiveStore();

const teamId = computed(() => live.myTeamIds[0] ?? null);
const team = computed(() => teamOf(store.pkg, teamId.value));
const deployments = computed(() => (teamId.value !== null ? myDeployments(live.incidents, teamId.value) : []));
</script>

<template>
  <main class="screen tight">
    <header class="header">
      <RouterLink :to="{ name: 'ehbo' }" aria-label="Terug" class="icon-btn"><Icon name="back" /></RouterLink>
      <div class="stack">
        <h1 class="heading">Mijn inzetten</h1>
        <span v-if="team" class="small">{{ team.name }}</span>
      </div>
    </header>

    <div v-if="deployments.length" class="list">
      <RouterLink v-for="i in deployments" :key="i.id" :to="{ name: 'inzet', params: { id: i.id } }" class="list-row deployment">
        <span class="main">
          <span class="title-line">{{ i.post.name }}</span>
          <span class="sub">{{ clock(i.reportedAt) }} · {{ incidentSummary(i) }}</span>
        </span>
        <span class="tag" :class="{ ok: i.status === 'afgerond' }">{{ i.status === 'afgerond' ? 'afgerond' : 'ingetrokken' }}</span>
        <Icon name="forward" :size="16" />
      </RouterLink>
    </div>
    <p v-else class="note">Nog geen inzetten. Een oproep die je aanneemt en afrondt, staat hier.</p>
  </main>
</template>

<style scoped>
.header { display: flex; align-items: center; gap: 4px; padding: 14px 0 10px; margin-left: -4px; }
.heading { font-size: 20px; font-weight: 700; line-height: 1.2; }
.deployment { min-height: 56px; color: var(--ink); text-decoration: none; }
</style>
