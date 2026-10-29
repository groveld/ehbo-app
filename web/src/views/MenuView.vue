<script setup lang="ts">
// Menu (laatste tab): je functies, beheer, meldingen, info, navigatie-app en afmelden. Elke post- of EHBO-functie heeft een eigen tab.
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { formatPhone } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import { getNavApp, NAV_APPS, setNavApp, type NavApp } from '../navigate.ts';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
const router = useRouter();
const me = computed(() => session.me!);
const navApp = ref<NavApp>(getNavApp());

// Rollen kunnen intussen gewijzigd zijn (bijv. door het beheer).
onMounted(() => session.refresh());

function chooseNavApp(app: NavApp) {
  navApp.value = app;
  setNavApp(app);
}

async function logout() {
  await session.logout();
  router.replace({ name: 'deelnemer' });
}
</script>

<template>
  <main v-if="session.me" class="screen tabbed">
    <div class="stack who">
      <span class="eyebrow">Aangemeld als</span>
      <h1 class="me-name">{{ me.name || formatPhone(me.phone) }}</h1>
      <span v-if="me.name" class="mono small">{{ formatPhone(me.phone) }}</span>
    </div>

    <div v-for="a in session.functions" :key="`${a.kind}-${a.postId ?? a.unitId ?? a.title}`" class="card place">
      <span class="badge letter" :style="{ background: a.color }">{{ a.letter }}</span>
      <span class="stack text">
        <span class="name">{{ a.title }}</span>
        <span v-if="a.detail" class="detail">{{ a.detail }}</span>
        <span v-if="a.times" class="small">{{ a.times }}</span>
      </span>
    </div>

    <nav class="stack gap-10 menu">
      <RouterLink v-if="me.isAdmin" :to="{ name: 'beheer' }" class="btn item"><Icon name="settings" :size="20" />Beheer</RouterLink>
      <RouterLink :to="{ name: 'info' }" class="btn item"><Icon name="info" :size="20" />Info &amp; voorwaarden</RouterLink>
      <RouterLink :to="{ name: 'controle' }" class="btn item"><Icon name="check" :size="20" />Pushmeldingen, locatie en controle</RouterLink>
    </nav>

    <div class="form-field nav-app">
      <label for="nav-app">Navigeren met</label>
      <select id="nav-app" class="input" :value="navApp" @change="chooseNavApp(($event.target as HTMLSelectElement).value as NavApp)">
        <option v-for="a in NAV_APPS" :key="a.value" :value="a.value">{{ a.label }}</option>
      </select>
    </div>

    <button class="btn link logout" @click="logout">Afmelden</button>
  </main>
</template>

<style scoped>
.who { gap: 2px; margin-bottom: 14px; }
.me-name { font-size: 24px; font-weight: 700; line-height: 1.2; }
.place { display: flex; align-items: center; gap: 14px; }
.place + .place { margin-top: 10px; }
/* Icoon links, tekst ernaast, alles links uitgelijnd. */
.item { justify-content: flex-start; gap: 12px; padding: 0 16px; text-align: left; }
.logout { color: var(--danger); font-weight: 700; }
.letter { width: 48px; height: 48px; color: #FFFFFF; font-size: 17px; }
.text { gap: 2px; flex-grow: 1; }
.name { font-size: 16px; font-weight: 700; }
.detail { font-size: 14px; color: var(--ink-2); }
.menu { margin-top: 18px; }
.nav-app { margin: 18px 0 6px; }
select.input { appearance: auto; }
</style>
