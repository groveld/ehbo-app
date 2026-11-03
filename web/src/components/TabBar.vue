<script setup lang="ts">
// Eén tabbalk onderaan elke medewerkerspagina: een tab per functie (elke post waar je staat, EHBO als je EHBO'er bent),
// kaart, meldingen (coördinator en beheer), contacten en menu. Zo hoef je tijdens het evenement nooit te wisselen.
// Een teller op een functie bij een lopende oproep, en op Meldingen voor aanvragen die nog niet zijn opgepakt; allebei even groot.
import { computed } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import { coordinatorOf } from '../locations.ts';
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
const COLORS = { firstAid: '#C8261E', map: '#0E7C86', requests: '#A16207', contacts: '#3F51B5', menu: '#3E434B' };

/** Het kruis van de EHBO-tab in de kleur van de eigen status: beschikbaar groen, niet beschikbaar (pauze of bezig) rood, uit dienst donker. */
const STATUS = { available: '#0A7D4F', unavailable: '#C8261E', off_duty: 'var(--ink)' } as const;

const EHBO = ['first-aid', 'self-start', 'assign', 'assign-incident', 'dispatch', 'close-incident'];
const MENU = ['menu', 'info', 'check', 'control'];

/** Bij welke post het huidige scherm hoort (startscherm, verzoek, melding, aanvraag of geen bereik), of null. */
const routeLocationId = computed(() => {
  const p = route.params;
  switch (route.name) {
    case 'location-home': case 'new-incident': case 'location-history': return Number(p.id);
    case 'location-incident': case 'location-request': return Number(p.locationId);
    case 'incident': return live.incidentById(Number(p.id))?.locationId ?? null;
    case 'add-to-incident': return live.incidentById(Number(p.incidentId))?.locationId ?? null;
    case 'request': return live.requestById(Number(p.id))?.locationId ?? null;
    case 'no-signal': return live.outbox.find((i) => i.clientId === p.clientId)?.locationId ?? null;
    default: return null;
  }
});

const ehboColor = computed(() => {
  const state = live.myTeamIds[0] !== undefined ? live.teamState(live.myTeamIds[0]) : null;
  return state?.incidentId || live.myActive ? STATUS.unavailable : STATUS[state?.availability ?? 'off_duty'];
});

const tabs = computed<Tab[]>(() => {
  const me = session.me!;
  const name = String(route.name ?? '');
  const tabs: Tab[] = [];
  if (me.assignments.some((a) => a.kind === 'team')) {
    tabs.push({ key: 'first-aid', to: { name: 'first-aid' }, label: 'EHBO', icon: 'ehbo', active: EHBO.includes(name), color: COLORS.firstAid, iconColor: ehboColor.value, count: live.invitations.length + (live.myActive ? 1 : 0) });
  }
  const locations = me.assignments.filter((a) => a.kind === 'location');
  for (const a of locations) {
    const locationId = a.locationId!;
    tabs.push({
      key: `post-${locationId}`, to: { name: 'location-home', params: { id: locationId } }, icon: 'pin',
      label: pkg.locationById.get(locationId)?.name.split(' · ')[0] ?? 'Locatie',
      active: routeLocationId.value === locationId,
      color: pkg.typeById.get(pkg.locationById.get(locationId)?.typeId ?? -1)?.color,
      count: live.openIncidents.filter((i) => i.locationId === locationId && !i.offLocation).length,
    });
  }
  tabs.push({ key: 'map', to: { name: 'map' }, label: 'Kaart', icon: 'map', active: name === 'map' || name === 'location', color: COLORS.map });
  if (me.isAdmin || coordinatorOf(pkg.pkg)?.phone === me.phone) {
    tabs.push({ key: 'requests', to: { name: 'requests' }, label: 'Meldingen', icon: 'bell', active: name === 'requests', color: COLORS.requests, count: live.requests.filter((r) => r.status === 'sent').length });
  }
  tabs.push({ key: 'contacts', to: { name: 'contacts' }, label: 'Contacten', icon: 'people', active: name === 'contacts', color: COLORS.contacts });
  tabs.push({ key: 'menu', to: { name: 'menu' }, label: 'Menu', icon: 'menu', active: MENU.includes(name) || name.startsWith('admin'), color: COLORS.menu });
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
