<script setup lang="ts">
// Meldingen: alles wat open is (EHBO-oproepen rood bovenaan, dan de wachtrij 5.2: water, verkeer, vrijwilliger), daarna wat is afgerond.
import { computed } from 'vue';
import { helpRequestType, requestDetailLabel, telHref, type LiveRequest } from '@ehbo/shared';
import Icon from '../../components/Icon.vue';
import { clock, incidentSummary, teamOf } from '../../incidents.ts';
import { useSave } from '../../composables/useSave.ts';
import { kmLabel, primaryContact } from '../../locations.ts';
import { isOpen, useLiveStore } from '../../stores/live.ts';
import { usePackageStore } from '../../stores/package.ts';
import { useSessionStore } from '../../stores/session.ts';

const store = usePackageStore();
const live = useLiveStore();
const session = useSessionStore();
const closed = computed(() => live.incidents.filter((i) => !isOpen(i)));
const { busy, error, run } = useSave();

/** Wie de wachtrij beheert: de coördinator, het kernteam en beheerders (zoals de server). */
const handles = computed(() => {
  const me = session.me;
  return Boolean(me && (me.isAdmin || me.assignments.some((a) => a.kind === 'core_team')));
});
const openRequests = computed(() => live.requests.filter((r) => r.status === 'sent' || r.status === 'accepted').slice().reverse());
const doneRequests = computed(() => live.requests.filter((r) => r.status === 'closed' || r.status === 'withdrawn'));
/** A request's type, with its name and the colours of its chip (#86). */
const typeOf = (r: LiveRequest) => helpRequestType(store.pkg?.helpRequestTypes, r.type);
const line = (r: LiveRequest) => {
  const location = store.locationById.get(r.locationId);
  return [r.locationName, location ? kmLabel(location) : null, requestDetailLabel(store.pkg?.helpRequestTypes, r.type, r.detail)?.toLowerCase()].filter(Boolean).join(' · ');
};
const locationPhone = (r: LiveRequest) => {
  const location = store.locationById.get(r.locationId);
  return location ? primaryContact(location)?.phone ?? null : null;
};
const pickedText = (r: LiveRequest) => (r.status === 'accepted'
  ? (r.acceptedBy?.phone === session.me?.phone ? 'Opgepakt door jou' : `Opgepakt door ${r.acceptedBy?.name}`)
  : r.status === 'closed' ? 'Afgehandeld' : r.status === 'withdrawn' ? 'Ingetrokken' : '');

const STATUS = { sent: 'zoekt EHBO', accepted: 'onderweg', on_site: 'ter plaatse', closed: 'afgerond', withdrawn: 'ingetrokken' } as const;
const who = (teamId: number | null) => teamOf(store.pkg, teamId)?.name;
</script>

<template>
  <main class="screen tight tabbed">

    <div class="stack gap-10">
      <span class="section-title">Open oproepen en verzoeken</span>
      <!-- EHBO-oproepen in dezelfde kaart als de aanvragen, met een eigen label; open oproepen met een rode rand. -->
      <RouterLink v-for="i in live.openIncidents" :key="i.id" :to="{ name: 'incident', params: { id: i.id } }" class="card incident open">
        <div class="request-top">
          <span class="kind ehbo">EHBO</span>
          <span class="picked grow state" :class="i.status">{{ STATUS[i.status] }}<template v-if="who(i.teamId)"> · {{ who(i.teamId) }}</template><template v-if="i.selfStarted"> · zelf gestart</template></span>
          <span class="mono at">{{ clock(i.reportedAt) }}</span>
        </div>
        <span class="request-line">{{ i.location.name }} · {{ incidentSummary(i) }}{{ i.aed ? ' · AED' : '' }}</span>
      </RouterLink>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div v-for="r in openRequests" :key="r.id" class="card request" :class="{ mine: r.status === 'accepted' && r.acceptedBy?.phone === session.me?.phone }">
        <div class="request-top">
          <span class="kind" :style="{ background: typeOf(r).colors.chip, color: typeOf(r).colors.chipText }">{{ typeOf(r).name }}</span>
          <span class="picked grow">{{ pickedText(r) }}</span>
          <span class="mono at">{{ clock(r.reportedAt) }}</span>
        </div>
        <RouterLink :to="{ name: 'request', params: { id: r.id } }" class="request-line open-link">{{ line(r) }}<Icon name="forward" :size="16" /></RouterLink>
        <div v-if="handles" class="request-actions">
          <a v-if="locationPhone(r)" :href="telHref(locationPhone(r)!)" class="btn call" :aria-label="`Bel ${r.locationName}`"><Icon name="phone" :size="20" /></a>
          <button v-if="r.status === 'sent'" class="btn primary-ish" :disabled="busy" @click="run(() => live.pickRequest(r.id))">Oppakken</button>
          <button v-else class="btn done" :disabled="busy" @click="run(() => live.finishRequest(r.id))">Afgehandeld</button>
        </div>
      </div>
      <p v-if="!live.openIncidents.length && !openRequests.length" class="card nothing-open"><Icon name="check" :size="20" />Niets open.</p>

      <template v-if="closed.length || doneRequests.length">
        <span class="section-title later">Afgerond</span>
        <RouterLink v-for="i in closed" :key="i.id" :to="{ name: 'incident', params: { id: i.id } }" class="card incident">
          <div class="request-top">
            <span class="kind ehbo">EHBO</span>
            <span class="picked grow">{{ STATUS[i.status] }}<template v-if="who(i.teamId)"> · {{ who(i.teamId) }}</template><template v-if="i.selfStarted"> · zelf gestart</template></span>
            <span class="mono at">{{ clock(i.reportedAt) }}</span>
          </div>
          <span class="request-line">{{ i.location.name }} · {{ incidentSummary(i) }}</span>
        </RouterLink>
        <div v-for="r in doneRequests" :key="r.id" class="card request">
          <div class="request-top">
            <span class="kind" :style="{ background: typeOf(r).colors.chip, color: typeOf(r).colors.chipText }">{{ typeOf(r).name }}</span>
            <span class="picked grow">{{ pickedText(r) }}</span>
            <span class="mono at">{{ clock(r.reportedAt) }}</span>
          </div>
          <RouterLink :to="{ name: 'request', params: { id: r.id } }" class="request-line open-link">{{ line(r) }}<Icon name="forward" :size="16" /></RouterLink>
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.incident { display: flex; flex-direction: column; gap: 10px; color: var(--ink); text-decoration: none; }
.incident.open { border: 2px solid var(--danger); }
.state { font-weight: 700; color: var(--danger); }
.state.geaccepteerd, .state.ter_plaatse { color: var(--ok-text); }
/* As tall as an open item, so the list looks the same with or without calls. */
.nothing-open { display: flex; align-items: center; gap: 8px; min-height: 80px; background: var(--ok-bg); color: #0A4D33; font-size: 15px; font-weight: 600; }
.later { margin-top: 8px; }
.request { display: flex; flex-direction: column; gap: 10px; }
.request.mine { border: 2px solid var(--ink); }
.request-top { display: flex; align-items: center; gap: 8px; }
.kind { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
.kind.ehbo { background: #FBE3E1; color: #8A1A14; }
.picked { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.request-line { font-size: 15px; font-weight: 600; }
.open-link { display: flex; align-items: center; justify-content: space-between; gap: 8px; color: var(--ink); text-decoration: none; }
.request-actions { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 8px; }
.call { padding: 0; }
.primary-ish { background: var(--primary); box-shadow: none; color: #FFFFFF; font-weight: 700; }
.done { background: var(--ok); box-shadow: none; color: #FFFFFF; font-weight: 700; }
.at { color: var(--muted); font-size: 13px; }
</style>
