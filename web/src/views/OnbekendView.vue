<script setup lang="ts">
// 2.5 · Nummer niet bekend.
import { formatPhone, telHref } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
</script>

<template>
  <main class="screen">
    <div class="stack gap-14 top">
      <span class="badge alert"><Icon name="warning" :size="26" /></span>
      <h1 class="title">Dit nummer staat niet in de lijst</h1>
      <span v-if="session.unknown" class="mono phone">{{ formatPhone(session.unknown.phone) }}</span>
      <p class="lead">Controleer het nummer. Gebruik je vandaag een andere telefoon dan opgegeven? Neem contact op met de coördinator.</p>
    </div>

    <div class="stack gap-10 actions">
      <RouterLink :to="{ name: 'aanmelden' }" class="btn primary">Ander nummer invullen</RouterLink>
      <a v-if="session.unknown?.coordinatorPhone" :href="telHref(session.unknown.coordinatorPhone)" class="btn">
        <Icon name="phone" :size="18" />Bel evenementcoördinator
      </a>
    </div>

    <div class="grow" />
    <div class="card outlined stack gap-6">
      <strong class="participant">Ben je deelnemer?</strong>
      <span class="small">Dan heb je geen aanmelding nodig. Je ziet de route, de posten en de starttijden.</span>
      <RouterLink :to="{ name: 'deelnemer' }" class="participant-link">Naar route-informatie</RouterLink>
    </div>
  </main>
</template>

<style scoped>
.top { padding-top: 72px; }
.alert { width: 56px; height: 56px; background: var(--warn-bg); color: #8A4A0B; }
.phone { font-size: 15px; color: var(--muted); }
.actions { margin-top: 28px; }
.participant { font-size: 14px; }
.participant-link { font-size: 14px; font-weight: 600; padding-top: 4px; }
</style>
