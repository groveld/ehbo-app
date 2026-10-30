<script setup lang="ts">
// Eén tabbalk onderaan elke medewerkerspagina: een tab per functie (elke post waar je staat, EHBO als je EHBO'er bent),
// kaart, meldingen (coördinator en beheer), contacten en menu. Zo hoef je tijdens het evenement nooit te wisselen.
// Een teller op een functie bij een lopende oproep, en op Meldingen voor aanvragen die nog niet zijn opgepakt; allebei even groot.
import { computed } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import { coordinatorOf } from '../posts.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';
import Icon, { type IconName } from './Icon.vue';

/**
 * color: eigen kleur van het actieve tabblad (icoon en gloed); bij een post de kleur van de soort post, anders de accentkleur.
 * iconColor: het icoon altijd in deze kleur, ook als het tabblad niet actief is (EHBO: de eigen status).
 */
interface Tab { key: string; to: RouteLocationRaw; label: string; icon: IconName; active: boolean; count?: number; color?: string; iconColor?: string }

const route = useRoute();
const session = useSessionStore();
const pkg = usePackageStore();
const live = useLiveStore();

/** Vaste kleuren van de tabbladen als ze actief zijn; EHBO in het rood. */
const COLORS = { ehbo: '#C8261E', kaart: '#0E7C86', meldingen: '#A16207', contacten: '#3F51B5', menu: '#3E434B' };

/** Het kruis van de EHBO-tab in de kleur van de eigen status: beschikbaar groen, niet beschikbaar (pauze of bezig) rood, uit dienst donker. */
const STATUS = { vrij: '#0A7D4F', pauze: '#C8261E', uit_dienst: 'var(--ink)' } as const;

const EHBO = ['ehbo', 'inzetten', 'oproep', 'afronden'];
const MENU = ['menu', 'info', 'controle'];

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

const ehboColor = computed(() => {
  const state = live.myUnitIds[0] !== undefined ? live.unitState(live.myUnitIds[0]) : null;
  return state?.incidentId || live.myActive ? STATUS.pauze : STATUS[state?.availability ?? 'uit_dienst'];
});

const tabs = computed<Tab[]>(() => {
  const me = session.me!;
  const name = String(route.name ?? '');
  const tabs: Tab[] = [];
  if (me.assignments.some((a) => a.kind === 'ehbo')) {
    tabs.push({ key: 'ehbo', to: { name: 'ehbo' }, label: 'EHBO', icon: 'ehboFilled', active: EHBO.includes(name), color: COLORS.ehbo, iconColor: ehboColor.value, count: live.invitations.length + (live.myActive ? 1 : 0) });
  }
  const posts = me.assignments.filter((a) => a.kind === 'post');
  for (const a of posts) {
    const postId = a.postId!;
    tabs.push({
      key: `post-${postId}`, to: { name: 'post-home', params: { id: postId } }, icon: 'pin',
      label: posts.length > 1 ? (pkg.postById.get(postId)?.name.split(' · ')[0] ?? 'Post') : 'Mijn post',
      active: routePostId.value === postId,
      color: pkg.typeById.get(pkg.postById.get(postId)?.typeId ?? -1)?.color,
      count: live.openIncidents.filter((i) => i.postId === postId).length,
    });
  }
  tabs.push({ key: 'kaart', to: { name: 'kaart' }, label: 'Kaart', icon: 'map', active: name === 'kaart' || name === 'post', color: COLORS.kaart });
  if (me.isAdmin || coordinatorOf(pkg.pkg)?.phone === me.phone) {
    tabs.push({ key: 'meldingen', to: { name: 'meldingen' }, label: 'Meldingen', icon: 'bell', active: name === 'meldingen', color: COLORS.meldingen, count: live.requests.filter((r) => r.status === 'aangevraagd').length });
  }
  tabs.push({ key: 'contacten', to: { name: 'contacten' }, label: 'Contacten', icon: 'people', active: name === 'contacten', color: COLORS.contacten });
  tabs.push({ key: 'menu', to: { name: 'menu' }, label: 'Menu', icon: 'menu', active: MENU.includes(name) || name.startsWith('beheer'), color: COLORS.menu });
  return tabs;
});
</script>

<template>
  <nav class="tabbar" aria-label="Hoofdmenu">
    <RouterLink
      v-for="tab in tabs" :key="tab.key" :to="tab.to" class="tab" :class="{ active: tab.active, status: tab.iconColor }"
      :style="{ '--tab-color': tab.color, '--icon-color': tab.iconColor }" :aria-current="tab.active ? 'page' : undefined"
    >
      <span class="icon">
        <Icon :name="tab.icon" :size="22" />
        <span v-if="tab.count" class="count" :aria-label="`${tab.count} nieuw`">{{ tab.count }}</span>
      </span>
      <span class="label">{{ tab.label }}</span>
    </RouterLink>
  </nav>
</template>

<style scoped>
.tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: grid; grid-auto-flow: column; grid-auto-columns: 1fr;
  /* De tabs staan in dezelfde kolom als de inhoud (.screen, max. 720 px); de balk zelf loopt door tot de randen. */
  /* Onderaan net zoveel ruimte als boven; op een iPhone alleen wat extra voor de veegbalk. */
  padding: 6px max(8px, calc((100% - 720px) / 2)) max(6px, calc(env(safe-area-inset-bottom) - 18px)); background: var(--card); border-top: 1px solid var(--divider);
}
.tab { min-width: 0; display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 52px; justify-content: center; font-size: 12px; color: var(--muted); text-decoration: none; }
.tab.active { color: var(--ink); font-weight: 700; }
/* Geen kader na een tik of klik; met het toetsenbord blijft de focus zichtbaar. */
.tab:focus:not(:focus-visible) { outline: none; }
.label { max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.icon { position: relative; display: flex; }
/* Waar je bent: het icoon in de eigen kleur van het tabblad, met een zachte ronde gloed in dezelfde kleur onder het hele item. */
.tab.active { background: radial-gradient(closest-side, color-mix(in srgb, var(--tab-color, var(--accent)) 25%, transparent), transparent); }
.tab.active .icon { color: var(--tab-color, var(--ink)); }
/* EHBO: het kruis altijd in de kleur van de status; de gloed blijft rood. */
.tab.status .icon { color: var(--icon-color); }
.count { position: absolute; top: -4px; right: -10px; background: var(--danger); color: #FFFFFF; border: 2px solid var(--card); border-radius: 999px; }
.count { min-width: 20px; height: 20px; padding: 0 5px; font: 700 11px/16px var(--mono); text-align: center; }
</style>
