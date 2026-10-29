<script setup lang="ts">
// Menu (laatste tab): je plek, andere plekken als je er meer hebt, beheer, meldingen, info, navigatie-app en afmelden.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import { getNavApp, NAV_APPS, setNavApp, type NavApp } from '../navigate.ts';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
const router = useRouter();
const me = computed(() => session.me!);
const navApp = ref<NavApp>(getNavApp());

// De tabbalk heeft één knop voor je eigen plek; wie er meer heeft, vindt de andere hier.
const several = computed(() => me.value.assignments.length > 1);
const myPosts = computed(() => me.value.assignments.filter((a) => a.kind === 'post'));
const isEhbo = computed(() => me.value.assignments.some((a) => a.kind === 'ehbo'));

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
    <div class="stack gap-6 top">
      <span class="eyebrow">{{ session.event?.name }}</span>
      <h1 class="title">Menu</h1>
    </div>

    <div v-if="session.place" class="card place">
      <span class="badge letter" :style="{ background: session.place.color }">{{ session.place.letter }}</span>
      <span class="stack text">
        <span class="name">{{ session.place.title }}</span>
        <span v-if="session.place.detail" class="detail">{{ session.place.detail }}</span>
        <span v-if="session.place.times" class="small">{{ session.place.times }}</span>
      </span>
    </div>

    <nav class="stack gap-10 menu">
      <template v-if="several">
        <RouterLink v-if="isEhbo" :to="{ name: 'stand-by' }" class="btn"><Icon name="cross" :size="20" />Stand-by en oproepen</RouterLink>
        <RouterLink v-for="p in myPosts" :key="p.postId" :to="{ name: 'post-home', params: { id: p.postId } }" class="btn">
          <Icon name="pin" :size="20" />{{ myPosts.length > 1 ? (p.detail?.split(' · ')[0] ?? 'Mijn post') : 'Mijn post' }}
        </RouterLink>
        <RouterLink :to="{ name: 'herkend' }" class="btn">Andere plek kiezen</RouterLink>
      </template>
      <RouterLink v-if="me.isAdmin" :to="{ name: 'beheer' }" class="btn"><Icon name="settings" :size="20" />Beheer</RouterLink>
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
  </main>
</template>

<style scoped>
.top { padding-top: max(20px, env(safe-area-inset-top)); }
.place { display: flex; align-items: center; gap: 14px; margin-top: 14px; }
.letter { width: 48px; height: 48px; color: #FFFFFF; font-size: 17px; }
.text { gap: 2px; flex-grow: 1; }
.name { font-size: 16px; font-weight: 700; }
.detail { font-size: 14px; color: var(--ink-2); }
.menu { margin-top: 18px; }
.nav-app { margin: 18px 0 6px; }
select.input { appearance: auto; }
</style>
