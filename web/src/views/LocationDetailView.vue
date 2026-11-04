<script setup lang="ts">
// 3.5 · Postdetail: waar is de post, hoe kom je er, wie bel je, en waar is de dichtstbijzijnde EHBO.
import { computed, defineAsyncComponent } from 'vue';
import { useRouter } from 'vue-router';
import { formatKm, formatPhone, telHref } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import KmPoints from '../components/KmPoints.vue';
import NotOnPhone from '../components/NotOnPhone.vue';
import LocationBadge from '../components/LocationBadge.vue';
import { navigationUrl } from '../navigate.ts';
import { confirmCloseLocation } from '../composables/useDialog.ts';
import { useSave } from '../composables/useSave.ts';
import { ROLE_TEXT, kmLabel, staffed, mobileTeams, nearestTeam, primaryContact, teamsAt } from '../locations.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

// The map library is large: the screen doesn't wait for it.
const EventMap = defineAsyncComponent(() => import('../components/EventMap.vue'));

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const session = useSessionStore();
const router = useRouter();
const toggle = useSave();
async function setOpen(open: boolean) {
  if (open || await confirmCloseLocation(location.value!.name)) await toggle.run(() => live.setLocationOpen(location.value!.id, open));
}

const location = computed(() => store.locationById.get(Number(props.id)) ?? null);
const type = computed(() => (location.value ? store.typeById.get(location.value.typeId) : undefined));
/** Every function of this location, the main one first (#83). */
const hasPeople = computed(() => (location.value ? staffed(store.pkg, location.value) : true));
/** A turnaround's run, by name. */
const runName = computed(() => (location.value?.runId != null ? store.pkg?.runs.find((r) => r.id === location.value!.runId)?.name ?? null : null));
const functionNames = computed(() => location.value?.functionIds.map((id) => store.typeById.get(id)?.name).filter(Boolean).join(' · ') ?? '');
const contact = computed(() => (location.value ? primaryContact(location.value) : null));
const here = computed(() => (store.pkg && location.value ? teamsAt(store.pkg, location.value.id) : []));
const nearest = computed(() => (store.pkg && location.value && !here.value.length ? nearestTeam(store.pkg, location.value) : null));
const isOpen = computed(() => (location.value ? live.locationOpen(location.value.id, location.value.isOpen) : false));
const mobile = computed(() => mobileTeams(store.pkg, live.state?.teams ?? [], live.serverNow));
/** Zoals op de kaart van het overzicht: open oproepen rood, dichte posten grijs. */
const alertIds = computed(() => [...new Set(live.openIncidents.map((i) => i.locationId))]);
/** Zoals de server: de locatieverantwoordelijke van deze post, of een beheerder. */
const canToggle = computed(() => session.me?.isAdmin
  || session.me?.assignments.some((a) => a.kind === 'location' && a.locationId === location.value?.id && a.role === 'lead'));

const subtitle = computed(() => {
  const p = location.value;
  if (!p) return '';
  const open = p.timeFrom && p.timeTo ? `open ${p.timeFrom} – ${p.timeTo}` : p.timeFrom ? `open vanaf ${p.timeFrom}` : null;
  return [kmLabel(p), open].filter(Boolean).join(' · ');
});

// Eén stap omhoog: de kaart (navigation.ts).
/** An EHBO team on duty and not busy can start an incident here: on site when it's there, otherwise en route first. */
const myTeam = computed(() => (live.myTeamIds[0] !== undefined ? live.teamState(live.myTeamIds[0]) : null));
const canStart = computed(() => !!myTeam.value && myTeam.value.availability !== 'off_duty' && !myTeam.value.incidentId);
const back = () => router.back();

/** Wat je doorgeeft als iemand vraagt waar de post is: het adres als dat is ingevuld, anders de GPS-positie. */
const place = computed(() => {
  const p = location.value;
  if (p?.address) return p.address;
  return p && p.lat !== null && p.lng !== null ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : null;
});

/** Welke EHBO-eenheid hier hoort: een vaste eenheid op haar eigen EHBO-post, of een mobiele eenheid met hier haar standplaats. */
const hereText = (u: { name: string; kind: string }) => (u.kind === 'fixed' ? `EHBO ${u.name} staat op deze locatie` : `Standplaats van EHBO ${u.name} (mobiel)`);
</script>

<template>
  <main class="screen tight">
    <header class="top">
      <button class="icon-btn" aria-label="Terug" @click="back"><Icon name="back" /></button>
      <span class="top-title">Locatie</span>
      <RouterLink v-if="session.me?.isAdmin && location" :to="{ name: 'admin-location', params: { id: location.id } }" class="edit">Bewerken</RouterLink>
    </header>

    <NotOnPhone v-if="!location || !store.pkg">Deze locatie bestaat niet (meer).</NotOnPhone>
    <template v-else>
      <div class="title">
        <LocationBadge :type="type" :size="56" />
        <div class="stack">
          <span class="type" :style="{ color: type?.color }">{{ functionNames }}<template v-if="runName"> · {{ runName }}</template></span>
          <h1>{{ location.name }}</h1>
          <span v-if="subtitle" class="small">{{ subtitle }}</span>
        </div>
      </div>

      <div v-if="location.lat !== null" class="map">
        <!-- Net als op het overzicht: tik op een andere post om die te openen. Die vervangt deze pagina, zodat Terug in één stap teruggaat naar waar je vandaan kwam. -->
        <EventMap
          :pkg="store.pkg" :focus-location-id="location.id" :alert-location-ids="alertIds"
          :ambulances="mobile.ambulances" :away-location-ids="mobile.awayLocationIds"
          @select="(id) => id !== location!.id && router.replace({ name: 'location', params: { id } })"
        />
      </div>

      <div class="card stack post-facts">
        <div v-if="place" class="fact location">
          <span class="stack">
            <span class="label">Positie</span>
            <span :class="location.address ? 'address' : 'mono coords'">{{ place }}</span>
          </span>
        </div>
        <div v-else class="fact"><span class="label">Positie</span><span>Nog geen positie vastgelegd</span></div>
        <div v-if="location.passages.length" class="fact stack gap-6"><span class="label">Km-punten</span><KmPoints :passages="location.passages" :runs="store.pkg.runs" /></div>
        <div v-if="location.accessRoute" class="fact"><span class="label">Aanrijroute hulpverlening</span><span>{{ location.accessRoute }}</span></div>
      </div>

      <!-- Open of dicht, live. Een beheerder kan elke post open en dicht zetten, voor wie minder technisch is. Not where nobody is (#69). -->
      <div v-if="hasPeople" class="card open-row">
        <span class="dot" :class="{ on: isOpen }" />
        <span class="grow"><strong>{{ isOpen ? 'Locatie is open' : 'Locatie is dicht' }}</strong></span>
        <button
          v-if="canToggle" class="switch" role="switch" :aria-checked="isOpen" aria-label="Locatie open"
          :disabled="toggle.busy.value" @click="setOpen(!isOpen)"
        />
      </div>
      <p v-if="toggle.error.value" class="error-text" role="alert">{{ toggle.error.value }}</p>

      <div v-if="location.contacts?.length" class="list">
        <div v-for="c in location.contacts" :key="c.phone" class="list-row">
          <span class="main">
            <span class="title-line">{{ c.name || 'Naam onbekend' }} · <span class="role">{{ ROLE_TEXT[c.role] }}</span></span>
            <span class="sub mono">{{ formatPhone(c.phone) }}</span>
          </span>
          <a :href="telHref(c.phone)" class="round" :aria-label="`Bel ${c.name || 'contactpersoon'}`"><Icon name="phone" :size="20" /></a>
        </div>
      </div>

      <p v-if="here.length" class="note ok nearest">
        <LocationBadge :type="store.pkg.functionTypes.find((t) => t.key === 'first_aid')" :size="22" />
        <strong>{{ here.map(hereText).join(' · ') }}</strong>
      </p>
      <p v-else-if="nearest" class="note ok nearest">
        <LocationBadge :type="store.pkg.functionTypes.find((t) => t.key === 'first_aid')" :size="22" />
        <span>Dichtstbijzijnde EHBO: <strong>{{ nearest.team.name }}</strong> bij {{ nearest.location.name }} · {{ formatKm(nearest.km) }} km</span>
      </p>

      <div class="grow" />
      <RouterLink v-if="canStart" :to="{ name: 'self-start', query: { location: location.id } }" class="btn go start">
        <Icon name="ehbo" :size="20" />Incident starten
      </RouterLink>
      <div class="actions">
        <a v-if="contact" :href="telHref(contact.phone)" class="btn big"><Icon name="phone" :size="20" />Bel locatie</a>
        <a
          v-if="location.lat !== null && location.lng !== null" :href="navigationUrl(location.lat, location.lng, location.name)"
          class="btn primary"
        ><Icon name="navigate" :size="20" />Navigeer</a>
      </div>
    </template>
  </main>
</template>

<style scoped>
.open-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.open-row .dot { width: 10px; height: 10px; border-radius: 50%; background: var(--dot); }
.open-row .dot.on { background: var(--ok); }
.top { display: flex; align-items: center; gap: 4px; padding: max(14px, env(safe-area-inset-top)) 0 6px; margin-left: -12px; }
.top-title { flex-grow: 1; font-size: 16px; font-weight: 700; }
.edit { font-size: 14px; font-weight: 600; padding: 12px 0; }
.title { display: flex; align-items: center; gap: 14px; margin: 10px 0 16px; }
.type { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
h1 { font-size: 22px; font-weight: 700; line-height: 1.2; }
.map { height: clamp(200px, 30dvh, 360px); margin-bottom: 12px; }
.post-facts { gap: 0; margin-bottom: 12px; }
.fact { border-radius: 0; padding: 10px 0; font-size: 14px; border-top: 1px solid var(--divider); }
.fact:first-child { border-top: none; padding-top: 0; }
.label { font-size: 12px; color: var(--muted); }
.coords { font-size: 16px; white-space: nowrap; }
.address { font-size: 16px; font-weight: 600; }
.role { font-weight: 400; }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--soft); color: var(--ink); }
.nearest { margin-top: 12px; align-items: center; }
.start { margin-top: 18px; }
.actions { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; padding-top: 18px; }
/* Twee knoppen naast elkaar zijn altijd even hoog. */
.btn.big { height: 56px; font-size: 16px; }
</style>
