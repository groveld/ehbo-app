<script setup lang="ts">
// Meldingen: alles wat open is (EHBO-oproepen rood bovenaan, dan de wachtrij 5.2: water, verkeer, vrijwilliger), daarna wat is afgerond.
import { computed } from 'vue';
import { REQUEST_KINDS, requestDetailLabel, telHref, type LiveRequest } from '@ehbo/shared';
import Icon from '../../components/Icon.vue';
import { clock, incidentSummary, unitOf } from '../../incidents.ts';
import { useSave } from '../../composables/useSave.ts';
import { kmLabel, primaryContact } from '../../posts.ts';
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
  return Boolean(me && (me.isAdmin || me.assignments.some((a) => a.kind === 'kernteam')));
});
const openRequests = computed(() => live.requests.filter((r) => r.status === 'aangevraagd' || r.status === 'opgepakt').slice().reverse());
const doneRequests = computed(() => live.requests.filter((r) => r.status === 'afgehandeld' || r.status === 'ingetrokken'));
const KIND_STYLE = { water: ['#E4EEF7', '#124A78'], verkeer: ['#FBE6D2', '#7A3F06'], vrijwilliger: ['#EDE4F7', '#4E2A82'] } as const;
const line = (r: LiveRequest) => {
  const post = store.postById.get(r.postId);
  return [post?.name, post ? kmLabel(post.km) : null, requestDetailLabel(r.kind, r.detail)?.toLowerCase()].filter(Boolean).join(' · ');
};
const postPhone = (r: LiveRequest) => {
  const post = store.postById.get(r.postId);
  return post ? primaryContact(post)?.phone ?? null : null;
};
const pickedText = (r: LiveRequest) => (r.status === 'opgepakt'
  ? (r.pickedBy?.phone === session.me?.phone ? 'Opgepakt door jou' : `Opgepakt door ${r.pickedBy?.name}`)
  : r.status === 'afgehandeld' ? 'Afgehandeld' : r.status === 'ingetrokken' ? 'Ingetrokken' : '');

const STATUS = { verstuurd: 'zoekt EHBO', geaccepteerd: 'onderweg', ter_plaatse: 'ter plaatse', afgerond: 'afgerond', ingetrokken: 'ingetrokken' } as const;
const who = (unitId: number | null) => unitOf(store.pkg, unitId)?.name;
</script>

<template>
  <main class="screen tight tabbed">

    <div class="stack gap-10">
      <span class="section-title">Open oproepen en verzoeken</span>
      <RouterLink v-for="i in live.openIncidents" :key="i.id" :to="{ name: 'melding', params: { id: i.id } }" class="card incident open">
        <span class="badge alert"><Icon name="cross" :size="20" /></span>
        <span class="stack grow text">
          <span class="name">{{ store.postById.get(i.postId)?.name ?? 'Post' }}</span>
          <span class="sub">{{ clock(i.reportedAt) }} · {{ incidentSummary(i) }}{{ i.aed ? ' · AED' : '' }}</span>
        </span>
        <span class="state" :class="i.status">{{ STATUS[i.status] }}<template v-if="who(i.unitId)"><br>{{ who(i.unitId) }}</template></span>
      </RouterLink>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div v-for="r in openRequests" :key="r.id" class="card request" :class="{ mine: r.status === 'opgepakt' && r.pickedBy?.phone === session.me?.phone }">
        <div class="request-top">
          <span class="kind" :style="{ background: KIND_STYLE[r.kind][0], color: KIND_STYLE[r.kind][1] }">{{ REQUEST_KINDS[r.kind].label }}</span>
          <span class="picked grow">{{ pickedText(r) }}</span>
          <span class="mono at">{{ clock(r.createdAt) }}</span>
        </div>
        <span class="request-line">{{ line(r) }}</span>
        <div v-if="handles" class="request-actions">
          <a v-if="postPhone(r)" :href="telHref(postPhone(r)!)" class="btn call" :aria-label="`Bel ${store.postById.get(r.postId)?.name}`"><Icon name="phone" :size="20" /></a>
          <button v-if="r.status === 'aangevraagd'" class="btn primary-ish" :disabled="busy" @click="run(() => live.pickRequest(r.id))">Oppakken</button>
          <button v-else class="btn done" :disabled="busy" @click="run(() => live.finishRequest(r.id))">Afgehandeld</button>
        </div>
      </div>
      <p v-if="!live.openIncidents.length && !openRequests.length" class="note ok">Niets open.</p>
      <p v-if="!live.connected" class="small">Geen live verbinding; dit is de laatst bekende stand.</p>

      <template v-if="closed.length || doneRequests.length">
        <span class="section-title later">Afgerond</span>
        <div v-if="closed.length" class="list">
          <RouterLink v-for="i in closed" :key="i.id" :to="{ name: 'melding', params: { id: i.id } }" class="list-row">
            <span class="mono at">{{ clock(i.reportedAt) }}</span>
            <span class="main">
              <span class="title-line">{{ store.postById.get(i.postId)?.name }}</span>
              <span class="sub">{{ incidentSummary(i) }}<template v-if="who(i.unitId)"> · {{ who(i.unitId) }}</template></span>
            </span>
            <span class="small">{{ STATUS[i.status] }}</span>
          </RouterLink>
        </div>
        <div v-for="r in doneRequests" :key="r.id" class="card request">
          <div class="request-top">
            <span class="kind" :style="{ background: KIND_STYLE[r.kind][0], color: KIND_STYLE[r.kind][1] }">{{ REQUEST_KINDS[r.kind].label }}</span>
            <span class="picked grow">{{ pickedText(r) }}</span>
            <span class="mono at">{{ clock(r.createdAt) }}</span>
          </div>
          <span class="request-line">{{ line(r) }}</span>
        </div>
      </template>
    </div>
  </main>
</template>

<style scoped>
.incident { display: flex; align-items: center; gap: 12px; padding: 12px; color: var(--ink); text-decoration: none; }
.incident.open { border: 2px solid var(--danger); }
.alert { width: 40px; height: 40px; background: var(--danger); color: #FFFFFF; }
.text { gap: 2px; min-width: 0; }
.name { font-size: 15px; font-weight: 600; }
.sub { font-size: 13px; color: var(--muted); }
.state { font-size: 12px; font-weight: 700; text-align: right; color: var(--danger); }
.state.geaccepteerd, .state.ter_plaatse { color: var(--ok-text); }
.later { margin-top: 8px; }
.request { display: flex; flex-direction: column; gap: 10px; }
.request.mine { border: 2px solid var(--ink); }
.request-top { display: flex; align-items: center; gap: 8px; }
.kind { font-size: 12px; font-weight: 700; padding: 3px 9px; border-radius: 999px; }
.picked { font-size: 12px; font-weight: 600; color: var(--ink-2); }
.request-line { font-size: 15px; font-weight: 600; }
.request-actions { display: grid; grid-template-columns: 48px minmax(0, 1fr); gap: 8px; }
.request-actions .btn { height: 48px; border-radius: 12px; }
.call { padding: 0; }
.primary-ish { background: var(--primary); color: #FFFFFF; font-weight: 700; }
.done { background: var(--ok); color: #FFFFFF; font-weight: 700; }
.at { color: var(--muted); font-size: 13px; }
</style>
