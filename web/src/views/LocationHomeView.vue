<script setup lang="ts">
// 3.1 · Locatie openen en 3.2 · Post open: wat heb je nodig? Het startscherm van een post.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { LOCATION_CONTACT_ROLE_LABEL, formatKm, formatPhone, helpRequestType, requestDetailLabel, telHref, type RequestKind } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import { iconOf } from '../icons.ts';
import NotOnPhone from '../components/NotOnPhone.vue';
import { confirmCloseLocation } from '../composables/useDialog.ts';
import { useSave } from '../composables/useSave.ts';
import { clock, incidentSummary } from '../incidents.ts';
import { coordinatorOf, kmLabel, nearestTeam } from '../locations.ts';
import { isOpen, useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const session = useSessionStore();
const router = useRouter();
const { busy, error, run } = useSave();

const location = computed(() => store.locationById.get(Number(props.id)) ?? null);
const open = computed(() => (location.value ? live.locationOpen(location.value.id, location.value.isOpen) : false));
const closing = computed(() => (location.value ? live.locationState(location.value.id)?.closesAt : null));
const autoClosed = computed(() => (location.value ? live.locationState(location.value.id)?.autoClosedAt : null));
const myRole = computed(() => session.me?.assignments.find((a) => a.kind === 'location' && a.locationId === location.value?.id));
const canOpen = computed(() => myRole.value?.role === 'lead' || session.me?.isAdmin);
const coordinator = computed(() => coordinatorOf(store.pkg));
const nearest = computed(() => (store.pkg && location.value ? nearestTeam(store.pkg, location.value) : null));
const openIncidents = computed(() => live.openIncidents.filter((i) => i.locationId === location.value?.id && !i.offLocation));
/** Eerder vandaag, op een eigen scherm. */
const earlier = computed(() => live.incidents.filter((i) => i.locationId === location.value?.id && !i.offLocation && !isOpen(i)).length
  + live.requests.filter((r) => r.locationId === location.value?.id && (r.status === 'closed' || r.status === 'withdrawn')).length);
/** Meldingen die zonder bereik op deze telefoon wachten. */
const waiting = computed(() => live.outbox.filter((i) => i.locationId === location.value?.id));

/** Eerst wie je bent, dan de post; "gepland" zolang de post dicht is, anders sinds wanneer hij open is. */
const eyebrow = computed(() => [myRole.value?.title, session.me?.name].filter(Boolean).join(' · '));
const planned = computed(() => {
  const p = location.value;
  if (!p) return '';
  const times = p.timeFrom && p.timeTo ? `gepland open ${p.timeFrom} – ${p.timeTo}` : null;
  return [kmLabel(p), times].filter(Boolean).join(' · ');
});

// A request in the coordinator's queue (5.1): one tile per queue type of the event (#86), in its own colours.
const tiles = computed(() => (store.pkg?.helpRequestTypes ?? []).filter((t) => t.handling === 'queue'));
/** Open aanvragen van deze post, onder de tegels. */
const openRequests = computed(() => live.requests.filter((r) => r.locationId === location.value?.id && (r.status === 'sent' || r.status === 'accepted')));

async function ask(kind: RequestKind) {
  if (!location.value) return;
  let id: number | null = null;
  // Zonder bereik gaat dit gewoon door: de aanvraag wacht op de telefoon tot er weer verbinding is.
  const ok = await run(async () => { id = (await live.request(location.value!.id, kind)).id; });
  if (ok && id !== null) router.push({ name: 'request', params: { id } });
}

async function setOpen(value: boolean) {
  if (!location.value) return;
  if (!value && !await confirmCloseLocation(location.value.name)) return;
  await run(() => live.setLocationOpen(location.value!.id, value));
}
</script>

<template>
  <main class="screen tight">
    <NotOnPhone v-if="!location || !store.pkg" class="top-gap">Deze locatie staat niet (meer) in de gegevens van het evenement.</NotOnPhone>
    <template v-else>
      <header class="head">
        <div class="stack gap-4 grow">
          <span class="eyebrow">{{ eyebrow }}</span>
          <h1>{{ location.name }}</h1>
          <span v-if="open" class="small">{{ kmLabel(location) }}<template v-if="location.km !== null"> · </template><strong class="open">locatie open</strong></span>
          <span v-else class="small">{{ planned }}</span>
        </div>
        <button v-if="open && canOpen" class="close-post" :disabled="busy" @click="setOpen(false)"><Icon name="close" :size="14" />Locatie sluiten</button>
      </header>

      <p v-if="error" class="error-text" role="alert">{{ error }}</p>

      <div v-if="open && closing" class="note warn closing">
        <span class="grow">Deze locatie sluit om <strong>{{ clock(closing) }}</strong>. De geplande tijd is voorbij.</span>
        <button v-if="canOpen" class="btn keep" :disabled="busy" @click="run(() => live.keepLocation(location!.id))">Open houden</button>
      </div>

      <!-- 3.1 · Post is dicht -->
      <template v-if="!open">
        <div class="card closed">
          <span class="closed-chip"><span class="dot" />LOCATIE IS DICHT</span>
          <p v-if="autoClosed" class="small center">Automatisch gesloten om {{ clock(autoClosed) }}: de geplande tijd was voorbij.</p>
          <p v-if="canOpen" class="lead center">Ben je op je plek en is alles klaar? Zet de locatie open. Dan ziet de evenementcoördinator dat je er bent en werkt de hulpknop. Je kunt de locatie zo vaak openen en sluiten als nodig.</p>
          <p v-else class="lead center">De locatieverantwoordelijke zet de locatie open. Daarna werkt de hulpknop ook voor jou.</p>
          <button v-if="canOpen" class="btn go" :disabled="busy" @click="setOpen(true)">Locatie openen</button>
        </div>

        <span class="section-label people-label">Op deze locatie</span>
        <div class="list">
          <div v-for="c in location.contacts ?? []" :key="c.phone" class="list-row">
            <span class="main">
              <span class="title-line">{{ c.name || formatPhone(c.phone) }}<template v-if="c.phone === session.me?.phone"> (jij)</template></span>
              <span class="sub">{{ LOCATION_CONTACT_ROLE_LABEL[c.role] }} · {{ formatPhone(c.phone) }}</span>
            </span>
            <a :href="telHref(c.phone)" class="round" :aria-label="`Bel ${c.name}`"><Icon name="phone" :size="17" /></a>
          </div>
        </div>
        <p v-if="nearest" class="note ok nearest">
          <Icon name="ehbo" :size="14" /><span>Dichtstbij: <strong>{{ nearest.location.name }}</strong> · {{ formatKm(nearest.km) }} km</span>
        </p>
      </template>

      <!-- 3.2 · Post open: wat heb je nodig? -->
      <template v-else>
        <span class="ask">Wat heb je nodig?</span>
        <div class="tiles">
          <RouterLink :to="{ name: 'new-incident', params: { id: location.id } }" class="tile ehbo">
            <span class="tile-icon" style="background: var(--danger)"><Icon name="ehbo" :size="22" /></span>
            <span class="tile-text"><span class="tile-label">EHBO</span><span class="tile-sub">Eerste hulp nodig</span></span>
          </RouterLink>
          <button
            v-for="t in tiles" :key="t.key" class="tile typed" :disabled="busy"
            :style="{ '--tile-bg': t.colors.bg, '--tile-line': t.colors.line, '--tile-icon': t.colors.icon }" @click="ask(t.key)"
          >
            <span class="tile-icon" :style="{ background: t.colors.icon, color: t.colors.iconText }"><Icon :name="iconOf(t.icon)" :size="22" /></span>
            <span class="tile-text"><span class="tile-label">{{ t.name }}</span><span v-if="t.sub" class="tile-sub">{{ t.sub }}</span></span>
          </button>
          <a :href="coordinator ? telHref(coordinator.phone) : undefined" class="tile other">
            <span class="tile-icon" style="background: var(--primary)"><Icon name="phone" :size="20" /></span>
            <span class="tile-text"><span class="tile-label">Bel de evenementcoördinator</span></span>
          </a>
        </div>

        <div class="card requests">
          <RouterLink v-for="r in openRequests" :key="`r${r.id}`" :to="{ name: 'request', params: { id: r.id } }" class="request">
            <span class="mono at">{{ clock(r.reportedAt) }}</span>
            <span class="grow">{{ [helpRequestType(store.pkg?.helpRequestTypes, r.type).name, requestDetailLabel(store.pkg?.helpRequestTypes, r.type, r.detail)].filter(Boolean).join(' · ') }}</span>
            <span class="state blue">{{ r.status === 'accepted' ? 'wordt geregeld' : `plek ${r.position}` }}</span>
            <Icon name="forward" :size="16" />
          </RouterLink>
          <RouterLink v-for="w in waiting" :key="w.clientId" :to="{ name: 'no-signal', params: { clientId: w.clientId } }" class="request">
            <span class="mono at">{{ clock(w.reportedAt) }}</span>
            <span class="grow">EHBO · {{ incidentSummary(w) }}</span>
            <span class="state">wacht op bereik</span>
            <Icon name="forward" :size="16" />
          </RouterLink>
          <template v-if="openIncidents.length">
            <RouterLink v-for="i in openIncidents" :key="i.id" :to="{ name: 'incident', params: { id: i.id } }" class="request">
              <span class="mono at">{{ clock(i.reportedAt) }}</span>
              <span class="grow">EHBO · {{ incidentSummary(i) }}</span>
              <span class="state">{{ i.status === 'sent' ? 'zoeken' : i.status === 'accepted' ? 'onderweg' : 'ter plaatse' }}</span>
              <Icon name="forward" :size="16" />
            </RouterLink>
          </template>
          <div v-else-if="!waiting.length && !openRequests.length" class="request"><span class="grow muted">Open verzoeken van deze locatie</span><strong>geen</strong></div>
        </div>
      </template>

      <div class="list earlier">
        <RouterLink :to="{ name: 'location-history', params: { id: location.id } }" class="list-row">
          <span class="grow">Eerder vandaag</span>
          <strong>{{ earlier || 'nog niets' }}</strong>
          <Icon name="forward" :size="16" />
        </RouterLink>
      </div>
    </template>
  </main>
</template>

<style scoped>
.top-gap { margin-top: 24px; }
.closing { align-items: center; margin-top: 8px; font-size: 14px; }
.keep { width: auto; flex-shrink: 0; padding: 0 14px; }
.head { display: flex; align-items: flex-start; gap: 8px; padding: max(20px, env(safe-area-inset-top)) 0 8px 4px; }
.gap-4 { gap: 4px; }
h1 { font-size: 24px; font-weight: 700; line-height: 1.2; }
.open { color: var(--ok-text); }
.close-post {
  flex-shrink: 0; height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid var(--danger-line); background: var(--danger-soft); color: var(--danger-text);
  font: 600 13px var(--sans); display: flex; align-items: center; gap: 6px; cursor: pointer; margin-top: 4px;
}
.icon-btn { margin: -2px -10px 0 -6px; }
.closed { display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 14px; padding: 18px; border-radius: 20px; }
.closed-chip { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--muted); background: var(--soft); padding: 6px 12px; border-radius: 999px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--dot); }
.center { text-align: center; }
.people-label { margin: 14px 4px 6px; }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--soft); color: var(--ink); }
.nearest { margin-top: 10px; align-items: center; }
.ask { font-size: 16px; font-weight: 700; padding: 14px 4px 10px; }
/* Bewust grote tegels: de enige uitzondering op de knopmaten. */
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.tile {
  height: 128px; border-radius: 18px; border: 1px solid; color: var(--ink); text-decoration: none;
  display: flex; flex-direction: column; justify-content: space-between; padding: 16px; -webkit-touch-callout: none;
}
.tile.ehbo { background: var(--danger-bg); border: 2px solid var(--danger); }
.tile.other { grid-column: 1 / -1; height: 72px; flex-direction: row; align-items: center; justify-content: flex-start; gap: 14px; background: var(--card); border-color: var(--field-line); }
/* A help request type's own colours; in dark its icon colour on the card, so a light tile doesn't glare. */
.tile.typed { background: var(--tile-bg); border-color: var(--tile-line); }
:root[data-theme="dark"] .tile.typed { background: color-mix(in srgb, var(--tile-icon) 18%, var(--card)); border-color: color-mix(in srgb, var(--tile-icon) 55%, var(--card)); }
.tile-icon { width: 44px; height: 44px; flex-shrink: 0; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #FFFFFF; }
.tile-text { display: flex; flex-direction: column; gap: 2px; }
.tile-label { font-size: 18px; font-weight: 700; }
.tile.other .tile-label { font-size: 17px; }
.tile-sub { font-size: 13px; color: var(--ink-2); }
.requests { margin-top: 12px; padding: 4px 14px; border-radius: 14px; }
.request { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 13px; color: var(--ink); text-decoration: none; }
.request + .request { border-top: 1px solid var(--divider); }
.at { color: var(--muted); }
.state { font-weight: 700; color: var(--danger); }
.state.blue { color: var(--info); }
.muted { color: var(--ink-2); }
.earlier { margin-top: 12px; }
.earlier .list-row { gap: 8px; min-height: 50px; font-size: 14px; color: var(--ink); text-decoration: none; }
</style>
