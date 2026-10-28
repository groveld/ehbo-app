<script setup lang="ts">
// Menu, en tijdelijk startscherm voor EHBO'ers en postverantwoordelijken (hun eigen startscherm komt in fase 3).
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Call112 from '../components/Call112.vue';
import Icon from '../components/Icon.vue';
import { getNavApp, NAV_APPS, setNavApp, type NavApp } from '../navigate.ts';
import { useSessionStore } from '../stores/session.ts';

const props = withDefaults(defineProps<{ menu?: boolean }>(), { menu: false });
const session = useSessionStore();
const router = useRouter();
const me = computed(() => session.me!);
const navApp = ref<NavApp>(getNavApp());

const comingNext = computed(() => (me.value.home === 'ehbo'
  ? 'Hier komt je stand-by-scherm voor oproepen.'
  : 'Hier komt het startscherm van je post, met de hulpknop.'));

// Rollen kunnen intussen gewijzigd zijn (bijv. door het beheer).
onMounted(() => session.refresh());

function chooseNavApp(app: NavApp) {
  navApp.value = app;
  setNavApp(app);
}

async function logout() {
  await session.logout();
  router.replace({ name: 'welkom' });
}
</script>

<template>
  <main v-if="session.me" class="screen">
    <header v-if="props.menu" class="page-header">
      <button class="icon-btn" aria-label="Terug" @click="router.back()"><Icon name="back" /></button>
      <h1>Menu</h1>
    </header>
    <div v-else class="stack gap-6 top">
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

    <p v-if="!props.menu && me.home !== 'overzicht'" class="note info coming">{{ comingNext }} Tot die tijd vind je alles in het overzicht.</p>

    <nav class="stack gap-10 menu">
      <RouterLink :to="{ name: 'kaart' }" class="btn" :class="{ primary: !props.menu }"><Icon name="map" :size="20" />Overzicht en kaart</RouterLink>
      <RouterLink v-if="me.isAdmin" :to="{ name: 'beheer' }" class="btn"><Icon name="settings" :size="20" />Beheer</RouterLink>
      <RouterLink v-if="me.assignments.length > 1" :to="{ name: 'herkend' }" class="btn">Andere plek kiezen</RouterLink>
      <RouterLink :to="{ name: 'toestemmingen' }" class="btn"><Icon name="bell" :size="18" />Meldingen en locatie</RouterLink>
      <RouterLink :to="{ name: 'info' }" class="btn"><Icon name="info" :size="18" />Info &amp; voorwaarden</RouterLink>
      <RouterLink :to="{ name: 'controle' }" class="btn">Controle van installatie</RouterLink>
    </nav>

    <div class="form-field nav-app">
      <label for="nav-app">Navigeren met</label>
      <select id="nav-app" class="input" :value="navApp" @change="chooseNavApp(($event.target as HTMLSelectElement).value as NavApp)">
        <option v-for="a in NAV_APPS" :key="a.value" :value="a.value">{{ a.label }}</option>
      </select>
    </div>

    <button class="btn link" @click="logout">Afmelden</button>

    <div class="grow" />
    <Call112 />
  </main>
</template>

<style scoped>
.top { padding-top: 56px; }
.page-header { margin-bottom: 8px; }
.place { display: flex; align-items: center; gap: 14px; margin-top: 14px; }
.letter { width: 48px; height: 48px; color: #FFFFFF; font-size: 17px; }
.text { gap: 2px; flex-grow: 1; }
.name { font-size: 16px; font-weight: 700; }
.detail { font-size: 14px; color: var(--ink-2); }
.coming { margin-top: 14px; }
.menu { margin-top: 18px; }
.nav-app { margin: 18px 0 6px; }
select.input { appearance: auto; }
</style>
