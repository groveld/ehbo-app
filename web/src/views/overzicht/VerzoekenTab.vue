<script setup lang="ts">
// Verzoeken: open EHBO-oproepen rood bovenaan, daarna wat vandaag is afgerond. De wachtrij (water, verkeer, vrijwilliger) volgt in fase 4.
import { computed } from 'vue';
import Icon from '../../components/Icon.vue';
import OverviewHeader from '../../components/OverviewHeader.vue';
import { clock, incidentSummary, unitOf } from '../../incidents.ts';
import { isOpen, useLiveStore } from '../../stores/live.ts';
import { usePackageStore } from '../../stores/package.ts';

const store = usePackageStore();
const live = useLiveStore();
const closed = computed(() => live.incidents.filter((i) => !isOpen(i)));

const STATUS = { verstuurd: 'zoekt EHBO', geaccepteerd: 'onderweg', ter_plaatse: 'ter plaatse', afgerond: 'afgerond', ingetrokken: 'ingetrokken' } as const;
const who = (unitId: number | null) => unitOf(store.pkg, unitId)?.name;
</script>

<template>
  <main class="screen tight">
    <OverviewHeader title="Verzoeken" />

    <div class="stack gap-10">
      <span class="section-title">Open EHBO-oproepen</span>
      <RouterLink v-for="i in live.openIncidents" :key="i.id" :to="{ name: 'melding', params: { id: i.id } }" class="card incident open">
        <span class="badge alert"><Icon name="cross" :size="20" /></span>
        <span class="stack grow text">
          <span class="name">{{ store.postById.get(i.postId)?.name ?? 'Post' }}</span>
          <span class="sub">{{ clock(i.reportedAt) }} · {{ incidentSummary(i) }}{{ i.aed ? ' · AED' : '' }}</span>
        </span>
        <span class="state" :class="i.status">{{ STATUS[i.status] }}<template v-if="who(i.unitId)"><br>{{ who(i.unitId) }}</template></span>
      </RouterLink>
      <p v-if="!live.openIncidents.length" class="note ok">Geen open oproepen.</p>
      <p v-if="!live.connected" class="small">Geen live verbinding; dit is de laatst bekende stand.</p>

      <template v-if="closed.length">
        <span class="section-title later">Afgerond en ingetrokken</span>
        <div class="list">
          <RouterLink v-for="i in closed" :key="i.id" :to="{ name: 'melding', params: { id: i.id } }" class="list-row">
            <span class="mono at">{{ clock(i.reportedAt) }}</span>
            <span class="main">
              <span class="title-line">{{ store.postById.get(i.postId)?.name }}</span>
              <span class="sub">{{ incidentSummary(i) }}<template v-if="who(i.unitId)"> · {{ who(i.unitId) }}</template></span>
            </span>
            <span class="small">{{ STATUS[i.status] }}</span>
          </RouterLink>
        </div>
      </template>

      <p class="note info">Verzoeken voor water, verkeer en vrijwilligers komen hier in een volgende versie. Tot dan bellen posten de evenementcoördinator.</p>
    </div>
  </main>
</template>

<style scoped>
.incident { display: flex; align-items: center; gap: 12px; padding: 12px; color: var(--ink); text-decoration: none; }
.incident.open { border: 2px solid var(--danger); }
.alert { width: 40px; height: 40px; background: var(--danger); color: #FFFFFF; }
.text { gap: 2px; min-width: 0; }
.name { font-size: 15px; font-weight: 600; }
.sub { font-size: 13px; color: var(--muted); }
.state { font-size: 12px; font-weight: 700; text-align: right; color: var(--danger); }
.state.geaccepteerd, .state.ter_plaatse { color: var(--ok-text); }
.later { margin-top: 8px; }
.at { color: var(--muted); font-size: 13px; }
</style>
