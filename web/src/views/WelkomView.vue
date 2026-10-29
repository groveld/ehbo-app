<script setup lang="ts">
// 2.1 · Startscherm: medewerker of deelnemer.
import { computed } from 'vue';
import Icon from '../components/Icon.vue';
import { formatDate } from '../format.ts';
import { canUseAsStaff } from '../platform.ts';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
const name = computed(() => session.event?.name ?? 'EHBO-app');
const staffRoute = canUseAsStaff ? { name: 'aanmelden' } : { name: 'installeren' };
</script>

<template>
  <main class="screen">
    <div class="stack gap-18 top">
      <!-- Groot logo van het evenement (Beheer → Evenement → Stijl); zonder logo de naam op de accentkleur. -->
      <img v-if="session.event?.brand.logo" :src="session.event.brand.logo" :alt="`Logo ${name}`" class="logo-image">
      <span v-else role="img" :aria-label="`Logo ${name}`" class="logo">{{ name }}</span>
      <div class="stack gap-6">
        <span class="eyebrow">{{ name }}<template v-if="session.event?.startDate"> · {{ formatDate(session.event.startDate) }}</template></span>
        <h1 class="title xl">Welkom</h1>
        <p class="lead">Wie ben je vandaag?</p>
      </div>
    </div>

    <nav class="stack gap-12 choices">
      <RouterLink :to="{ name: 'deelnemer' }" class="choice">
        <span class="badge circle" style="background: var(--info-bg); color: var(--info-icon)"><Icon name="runner" :size="26" /></span>
        <span class="stack text">
          <span class="label">Deelnemer</span>
          <span class="sub">Route, posten en starttijden</span>
        </span>
        <Icon name="forward" :size="20" />
      </RouterLink>
      <RouterLink :to="staffRoute" class="choice dark">
        <span class="badge circle" style="background: var(--accent); color: var(--ink)"><Icon name="people" :size="26" /></span>
        <span class="stack text">
          <span class="label">Medewerker / vrijwilliger</span>
          <span class="sub">Aanmelden met je telefoonnummer</span>
        </span>
        <Icon name="forward" :size="20" />
      </RouterLink>
    </nav>
  </main>
</template>

<style scoped>
.top { padding-top: 80px; }
.logo {
  align-self: flex-start; max-width: 100%; min-width: 180px; padding: 16px 18px; border-radius: 16px;
  background: var(--accent); color: var(--ink); font-size: 22px; font-weight: 700; letter-spacing: -0.02em; line-height: 1.1; text-transform: uppercase;
}
.logo-image { align-self: flex-start; max-width: 100%; max-height: 96px; object-fit: contain; object-position: left center; }
.choices { padding-top: 36px; }
.choice {
  display: flex; align-items: center; gap: 16px; padding: 18px; border-radius: 18px;
  background: var(--card); border: 1px solid var(--line); color: var(--ink); text-decoration: none;
}
.choice.dark { background: var(--primary); border-color: var(--primary); color: #FFFFFF; }
.circle { width: 52px; height: 52px; }
.text { gap: 2px; flex-grow: 1; }
.label { font-size: 18px; font-weight: 700; }
.sub { font-size: 14px; color: var(--muted); }
.dark .sub { color: var(--soft-text); }
</style>
