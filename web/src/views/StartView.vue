<script setup lang="ts">
// Tijdelijk startscherm (fase 2a). Het overzicht met kaart komt in fase 2c, stand-by en de post in fase 3.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import Call112 from '../components/Call112.vue';
import Icon from '../components/Icon.vue';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
const router = useRouter();
const me = computed(() => session.me!);

const comingNext = computed(() => {
  switch (me.value.home) {
    case 'ehbo': return 'Hier komt je stand-by-scherm voor oproepen.';
    case 'post': return 'Hier komt het startscherm van je post, met de hulpknop.';
    default: return 'Hier komt het overzicht met kernteam, posten en de kaart.';
  }
});

async function logout() {
  await session.logout();
  router.replace({ name: 'welkom' });
}
</script>

<template>
  <main v-if="session.me" class="screen">
    <div class="stack gap-6 top">
      <span class="eyebrow">{{ session.event?.name }}</span>
      <h1 class="title">Hoi{{ session.firstName ? ` ${session.firstName}` : '' }}</h1>
    </div>

    <div v-if="session.place" class="card place">
      <span class="badge letter" :style="{ background: session.place.color }">{{ session.place.letter }}</span>
      <span class="stack text">
        <span class="name">{{ session.place.title }}</span>
        <span v-if="session.place.detail" class="detail">{{ session.place.detail }}</span>
        <span v-if="session.place.times" class="small">{{ session.place.times }}</span>
      </span>
    </div>

    <p class="note info coming">{{ comingNext }} Je bent aangemeld en klaar voor de volgende versie.</p>

    <nav class="stack gap-10 menu">
      <RouterLink v-if="me.assignments.length > 1" :to="{ name: 'herkend' }" class="btn">Andere plek kiezen</RouterLink>
      <RouterLink :to="{ name: 'toestemmingen' }" class="btn"><Icon name="bell" :size="18" />Meldingen en locatie</RouterLink>
      <RouterLink :to="{ name: 'info' }" class="btn"><Icon name="info" :size="18" />Info &amp; voorwaarden</RouterLink>
      <RouterLink :to="{ name: 'controle' }" class="btn">Controle van installatie</RouterLink>
      <button class="btn link" @click="logout">Afmelden</button>
    </nav>

    <div class="grow" />
    <Call112 />
  </main>
</template>

<style scoped>
.top { padding-top: 56px; }
.place { display: flex; align-items: center; gap: 14px; margin-top: 22px; }
.letter { width: 48px; height: 48px; color: #FFFFFF; font-size: 17px; }
.text { gap: 2px; flex-grow: 1; }
.name { font-size: 16px; font-weight: 700; }
.detail { font-size: 14px; color: var(--ink-2); }
.coming { margin-top: 14px; }
.menu { margin-top: 22px; }
</style>
