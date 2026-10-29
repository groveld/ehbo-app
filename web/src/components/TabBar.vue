<script setup lang="ts">
// Eén tabbalk onderaan elke medewerkerspagina: je eigen plek (post of stand-by), kaart, verzoeken (coördinator en beheer), contacten en menu.
// Een rode stip op je eigen plek bij een lopende oproep; een teller op Verzoeken voor wat nog niet is opgepakt.
import { computed } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import { coordinatorOf } from '../posts.ts';
import { homeRoute } from '../router.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';
import Icon, { type IconName } from './Icon.vue';

interface Tab { to: RouteLocationRaw; label: string; icon: IconName; routes: string[]; dot?: boolean; count?: number }

const route = useRoute();
const session = useSessionStore();
const pkg = usePackageStore();
const live = useLiveStore();

// Welke schermen bij welke tab horen, zodat de tab ook daar actief blijft.
const POST = ['post-home', 'ehbo-verzoek', 'aanvullen', 'melding', 'aanvraag', 'geen-bereik'];
const EHBO = ['stand-by', 'oproep', 'afronden'];
const MENU = ['menu', 'herkend', 'toestemmingen', 'info', 'controle'];

const tabs = computed<Tab[]>(() => {
  const me = session.me!;
  const home = homeRoute();
  const tabs: Tab[] = [];
  if (home.name === 'stand-by') tabs.push({ to: home, label: 'Stand-by', icon: 'cross', routes: EHBO, dot: live.invitations.length > 0 || live.myActive !== null });
  else if (home.name === 'post-home') tabs.push({ to: home, label: 'Mijn post', icon: 'pin', routes: POST, dot: live.openIncidents.some((i) => live.myPostIds.includes(i.postId)) });
  tabs.push({ to: { name: 'kaart' }, label: 'Kaart', icon: 'map', routes: ['kaart', 'post'] });
  if (me.isAdmin || coordinatorOf(pkg.pkg)?.phone === me.phone) tabs.push({ to: { name: 'verzoeken' }, label: 'Verzoeken', icon: 'bell', routes: ['verzoeken'], count: live.requests.filter((r) => r.status === 'aangevraagd').length });
  tabs.push({ to: { name: 'contacten' }, label: 'Contacten', icon: 'people', routes: ['contacten'] });
  tabs.push({ to: { name: 'menu' }, label: 'Menu', icon: 'menu', routes: MENU });
  return tabs;
});

const name = computed(() => String(route.name ?? ''));
const active = (tab: Tab) => tab.routes.includes(name.value) || (tab.label === 'Menu' && name.value.startsWith('beheer'));
</script>

<template>
  <nav class="tabbar" aria-label="Hoofdmenu">
    <RouterLink v-for="tab in tabs" :key="tab.label" :to="tab.to" class="tab" :class="{ active: active(tab) }" :aria-current="active(tab) ? 'page' : undefined">
      <span class="icon">
        <Icon :name="tab.icon" :size="22" />
        <span v-if="tab.count" class="count" :aria-label="`${tab.count} nieuw`">{{ tab.count }}</span>
        <span v-else-if="tab.dot" class="dot" aria-label="lopende oproep" />
      </span>
      <span>{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  /* De tabs staan in dezelfde kolom als de inhoud (.screen, max. 480 px); de balk zelf loopt door tot de randen. */
  padding: 8px max(8px, calc((100% - 480px) / 2)) max(8px, env(safe-area-inset-bottom)); background: var(--card); border-top: 1px solid var(--divider);
}
.tab { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 52px; justify-content: center; font-size: 12px; color: var(--muted); text-decoration: none; }
.tab.active { color: var(--ink); font-weight: 700; }
.icon { position: relative; display: flex; }
.count, .dot { position: absolute; top: -4px; right: -10px; background: var(--danger); color: #FFFFFF; border: 2px solid var(--card); border-radius: 999px; }
.count { min-width: 20px; height: 20px; padding: 0 5px; font: 700 11px/16px var(--mono); text-align: center; }
.dot { width: 12px; height: 12px; top: -2px; right: -4px; }
</style>
