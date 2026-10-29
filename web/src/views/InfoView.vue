<script setup lang="ts">
// 2.6 · Info & voorwaarden. Voor iedereen te lezen; medewerkers vinden hem in het menu.
import { useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
const router = useRouter();

// Eén stap omhoog: het menu, of zonder aanmelding de deelnemerspagina (navigation.ts).
const back = () => router.back();
</script>

<template>
  <main class="screen tight">
    <header class="header">
      <button aria-label="Terug" class="icon-btn" @click="back"><Icon name="back" /></button>
      <h1 class="heading">Info &amp; voorwaarden</h1>
    </header>

    <div class="stack gap-10">
      <section v-for="section in session.event?.info ?? []" :key="section.title" class="card stack section">
        <h2 class="section-title">{{ section.title }}</h2>
        <p class="section-body">{{ section.body }}</p>
      </section>
      <p v-if="!session.event" class="note">Geen bereik. De info-pagina verschijnt zodra de app één keer verbinding heeft gehad.</p>
    </div>
  </main>
</template>

<style scoped>
.header { display: flex; align-items: center; gap: 4px; padding: 14px 0 6px; margin-left: -4px; }
.heading { font-size: 20px; font-weight: 700; }
.section { gap: 4px; }
.section-title { font-size: 15px; font-weight: 700; }
.section-body { font-size: 14px; color: var(--ink-2); line-height: 1.45; }
.footer { padding-top: 12px; }
.center { text-align: center; font-size: 12px; }
</style>
