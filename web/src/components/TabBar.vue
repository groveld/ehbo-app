<script setup lang="ts">
// Eén tabbalk onderaan elke medewerkerspagina: een tab per functie (elke post waar je staat, stand-by als je EHBO'er bent),
// kaart, verzoeken (coördinator en beheer), contacten en menu. Zo hoef je tijdens het evenement nooit te wisselen.
// Een rode stip op een functie bij een lopende oproep; een teller op Verzoeken voor wat nog niet is opgepakt.
import { computed } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import { coordinatorOf } from '../posts.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';
import Icon, { type IconName } from './Icon.vue';

interface Tab { key: string; to: RouteLocationRaw; label: string; icon: IconName; active: boolean; dot?: boolean; count?: number }

const route = useRoute();
const session = useSessionStore();
const pkg = usePackageStore();
const live = useLiveStore();

const EHBO = ['stand-by', 'oproep', 'afronden'];
const MENU = ['menu', 'herkend', 'toestemmingen', 'info', 'controle'];

/** Bij welke post het huidige scherm hoort (startscherm, verzoek, melding, aanvraag of geen bereik), of null. */
const routePostId = computed(() => {
  const p = route.params;
  switch (route.name) {
    case 'post-home': case 'ehbo-verzoek': return Number(p.id);
    case 'melding': return live.incidentById(Number(p.id))?.postId ?? null;
    case 'aanvullen': return live.incidentById(Number(p.incidentId))?.postId ?? null;
    case 'aanvraag': return live.requestById(Number(p.id))?.postId ?? null;
    case 'geen-bereik': return live.outbox.find((i) => i.clientId === p.clientId)?.postId ?? null;
    default: return null;
  }
});

const tabs = computed<Tab[]>(() => {
  const me = session.me!;
  const name = String(route.name ?? '');
  const tabs: Tab[] = [];
  if (me.assignments.some((a) => a.kind === 'ehbo')) {
    tabs.push({ key: 'ehbo', to: { name: 'stand-by' }, label: 'Stand-by', icon: 'cross', active: EHBO.includes(name), dot: live.invitations.length > 0 || live.myActive !== null });
  }
  const posts = me.assignments.filter((a) => a.kind === 'post');
  for (const a of posts) {
    const postId = a.postId!;
    tabs.push({
      key: `post-${postId}`, to: { name: 'post-home', params: { id: postId } }, icon: 'pin',
      label: posts.length > 1 ? (pkg.postById.get(postId)?.name.split(' · ')[0] ?? 'Post') : 'Mijn post',
      active: routePostId.value === postId,
      dot: live.openIncidents.some((i) => i.postId === postId),
    });
  }
  tabs.push({ key: 'kaart', to: { name: 'kaart' }, label: 'Kaart', icon: 'map', active: name === 'kaart' || name === 'post' });
  if (me.isAdmin || coordinatorOf(pkg.pkg)?.phone === me.phone) {
    tabs.push({ key: 'verzoeken', to: { name: 'verzoeken' }, label: 'Verzoeken', icon: 'bell', active: name === 'verzoeken', count: live.requests.filter((r) => r.status === 'aangevraagd').length });
  }
  tabs.push({ key: 'contacten', to: { name: 'contacten' }, label: 'Contacten', icon: 'people', active: name === 'contacten' });
  tabs.push({ key: 'menu', to: { name: 'menu' }, label: 'Menu', icon: 'menu', active: MENU.includes(name) || name.startsWith('beheer') });
  return tabs;
});
</script>

<template>
  <nav class="tabbar" aria-label="Hoofdmenu">
    <RouterLink v-for="tab in tabs" :key="tab.key" :to="tab.to" class="tab" :class="{ active: tab.active }" :aria-current="tab.active ? 'page' : undefined">
      <span class="icon">
        <Icon :name="tab.icon" :size="22" />
        <span v-if="tab.count" class="count" :aria-label="`${tab.count} nieuw`">{{ tab.count }}</span>
        <span v-else-if="tab.dot" class="dot" aria-label="lopende oproep" />
      </span>
      <span class="label">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  /* De tabs staan in dezelfde kolom als de inhoud (.screen, max. 720 px); de balk zelf loopt door tot de randen. */
  padding: 8px max(8px, calc((100% - 720px) / 2)) max(8px, env(safe-area-inset-bottom)); background: var(--card); border-top: 1px solid var(--divider);
}
.tab { min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 52px; justify-content: center; font-size: 12px; color: var(--muted); text-decoration: none; }
.tab.active { color: var(--ink); font-weight: 700; }
.label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon { position: relative; display: flex; }
.count, .dot { position: absolute; top: -4px; right: -10px; background: var(--danger); color: #FFFFFF; border: 2px solid var(--card); border-radius: 999px; }
.count { min-width: 20px; height: 20px; padding: 0 5px; font: 700 11px/16px var(--mono); text-align: center; }
.dot { width: 12px; height: 12px; top: -2px; right: -4px; }
</style>
