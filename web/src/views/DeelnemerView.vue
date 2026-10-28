<script setup lang="ts">
// 2.8 · Deelnemer: route en tijden. Kaart, posten en starttijden komen in fase 2c.
import Call112 from '../components/Call112.vue';
import Icon from '../components/Icon.vue';
import { formatDate } from '../format.ts';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
</script>

<template>
  <main class="screen">
    <div class="stack gap-18 top">
      <RouterLink :to="{ name: 'welkom' }" aria-label="Terug" class="icon-btn back"><Icon name="back" /></RouterLink>
      <div class="stack gap-6">
        <span class="eyebrow">Deelnemer</span>
        <h1 class="title">{{ session.event?.name ?? 'Route en tijden' }}</h1>
        <p v-if="session.event?.startDate" class="lead">{{ formatDate(session.event.startDate) }}</p>
      </div>
    </div>

    <p class="note info coming">De route, de posten en de starttijden verschijnen hier binnenkort.</p>
    <RouterLink :to="{ name: 'info' }" class="btn info-link"><Icon name="info" :size="18" />Info over deze app</RouterLink>

    <div class="grow" />
    <Call112 />
  </main>
</template>

<style scoped>
.top { padding-top: 14px; }
.back { margin-left: -12px; }
.coming { margin-top: 28px; }
.info-link { margin-top: 12px; }
</style>
