<script setup lang="ts">
// EHBO: 4.3 · oproep (aftellen), 4.4 · naar alle eenheden, 4.5 · al aangenomen, 4.7 · onderweg → ter plaatse.
import { computed, defineAsyncComponent, onBeforeUnmount, ref } from 'vue';
import { useRouter } from 'vue-router';
import { INCIDENT_WHAT, RESPONSIVE, formatKm, telHref } from '@ehbo/shared';
import ActivityLog from '../components/ActivityLog.vue';
import Icon from '../components/Icon.vue';
import NotOnPhone from '../components/NotOnPhone.vue';
import StatusBlock from '../components/StatusBlock.vue';
import { useSave } from '../composables/useSave.ts';
import { clock, incidentLog, incidentSummary, lastAddition, personsText, postOf, travelMinutes, teamOf } from '../incidents.ts';
import { navigationUrl } from '../navigate.ts';
import { callLines, primaryContact } from '../posts.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { load, save } from '../storage.ts';

// The map library is large: the screen doesn't wait for it.
const EventMap = defineAsyncComponent(() => import('../components/EventMap.vue'));

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();
const { busy, error, run } = useSave();

/** Omtrek van de aftelring (r = 30). */
const RING = 2 * Math.PI * 30;

const incident = computed(() => live.incidentById(Number(props.id)));
const post = computed(() => (incident.value ? postOf(store.postById, incident.value) : undefined));
const contact = computed(() => (post.value ? primaryContact(post.value) : null));

/** Mijn eenheid voor deze oproep: die is opgeroepen of heeft aangenomen; anders mijn eerste eenheid. */
const myDispatch = computed(() => incident.value?.dispatches.find((d) => live.myTeamIds.includes(d.teamId)) ?? null);
const myTeamId = computed(() => myDispatch.value?.teamId ?? live.myTeamIds[0] ?? null);
const myTeam = computed(() => teamOf(store.pkg, myTeamId.value));

const mode = computed(() => {
  const i = incident.value;
  if (!i) return 'missing';
  if (i.status === 'ingetrokken') return 'withdrawn';
  if (myDispatch.value?.acceptedAt) return i.status === 'afgerond' ? 'closed' : 'enroute';
  if (i.status === 'afgerond') return 'closed';
  if (myDispatch.value?.declinedAt && i.status === 'verstuurd') return 'declined';
  if (live.invitations.some((x) => x.id === i.id)) return i.stage === 'alle' && i.status === 'verstuurd' ? 'all' : 'call';
  if (i.status === 'verstuurd') return 'watching';
  return 'taken';
});

const left = computed(() => (incident.value ? live.secondsLeft(incident.value) : null));
const totalSeconds = computed(() => {
  const i = incident.value;
  return i?.escalatesAt ? Math.max(1, Math.round((new Date(i.escalatesAt).getTime() - new Date(i.sentAt).getTime()) / 1000)) : 30;
});
const km = computed(() => myDispatch.value?.distanceKm ?? null);
const minutes = computed(() => travelMinutes(km.value, myTeam.value));
const takenBy = computed(() => teamOf(store.pkg, incident.value?.teamId ?? null));
/** Na accepteren zonder AED: een eenheid met AED is nog nodig. */
const aedCall = computed(() => mode.value === 'call' && incident.value?.status !== 'verstuurd');
const firstTeam = computed(() => {
  const first = incident.value?.dispatches.find((d) => d.reason === 'dichtstbij');
  return first ? teamOf(store.pkg, first.teamId)?.name : null;
});
const others = computed(() => (incident.value?.dispatches ?? []).filter((d) => d.teamId !== myTeamId.value).map((d) => ({
  name: teamOf(store.pkg, d.teamId)?.name ?? 'Eenheid',
  kind: teamOf(store.pkg, d.teamId)?.kind,
  state: d.acceptedAt ? 'accepted' : d.declinedAt ? 'declined' : 'pending',
  km: d.distanceKm,
})));
/** From this team to the call, on the map. */
const lines = computed(() => callLines(store.pkg, live.teams.filter((u) => u.id === myTeamId.value), live.incidents, live.serverNow));
const navUrl = computed(() => (post.value?.lat != null && post.value.lng != null ? navigationUrl(post.value.lat, post.value.lng, post.value.name) : null));

// En route: what the post added is marked new until the team has seen it (a tap, or leaving the screen).
const SEEN_KEY = 'ehbo.seen-additions';
const seen = ref<Record<string, string>>(load(SEEN_KEY) ?? {});
const added = computed(() => (incident.value ? lastAddition(incident.value) : null));
const fresh = computed(() => mode.value === 'enroute' && added.value !== null && seen.value[props.id] !== added.value);
function markSeen() {
  if (!fresh.value) return;
  seen.value = { ...seen.value, [props.id]: added.value! };
  save(SEEN_KEY, seen.value);
}
onBeforeUnmount(markSeen);

async function accept() {
  if (!incident.value || myTeamId.value === null) return;
  if (await run(() => live.accept(incident.value!.id, myTeamId.value!)) && navUrl.value) location.href = navUrl.value;
}
async function decline() {
  if (!incident.value || myTeamId.value === null) return;
  await run(() => live.decline(incident.value!.id, myTeamId.value!));
}
const toEhbo = () => router.replace({ name: 'ehbo' });
/** On site, the next step is closing the incident; also without signal. */
async function onSite() {
  if (incident.value && await run(() => live.onSite(incident.value!.id))) void router.replace({ name: 'afronden', params: { id: props.id } });
}
</script>

<template>
  <main class="screen tight">
    <template v-if="mode === 'missing' || !incident || !post">
      <NotOnPhone class="top-gap">Deze oproep staat (nog) niet op deze telefoon.</NotOnPhone>
      <div class="grow" />
      <button class="btn primary" @click="toEhbo">Terug naar EHBO</button>
    </template>

    <!-- 4.3 · Oproep, en 4.4 · naar alle eenheden -->
    <template v-else-if="mode === 'call' || mode === 'all'">
      <StatusBlock
        tone="red" :label="mode === 'all' ? '' : aedCall ? 'AED nodig' : `Oproep · ${myTeam?.name ?? ''}`" :title="post.name"
      >
        <template v-if="mode === 'all'" #label><span class="all-chip">Alle eenheden</span></template>
        <div v-if="mode === 'call' && left !== null" class="ring">
          <svg width="64" height="64" viewBox="0 0 72 72" role="img" :aria-label="`Nog ${left} seconden om te reageren`">
            <circle cx="36" cy="36" r="30" fill="none" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="6" />
            <circle
              cx="36" cy="36" r="30" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"
              :stroke-dasharray="`${(left / totalSeconds) * RING} ${RING}`" transform="rotate(-90 36 36)"
            />
          </svg>
          <span class="ring-text"><span class="mono">{{ left }}</span><span class="sec">sec</span></span>
        </div>
      </StatusBlock>

      <p class="card what gap-top"><strong>{{ incidentSummary(incident) }}</strong><span class="small"> · gemeld {{ clock(incident.reportedAt) }}</span></p>
      <p v-if="incident.aed && myTeam?.hasAed" class="note warn gap-top"><strong>AED meenemen.</strong> De persoon is niet aanspreekbaar.</p>
      <p v-if="aedCall" class="note warn gap-top">{{ takenBy?.name }} is onderweg zonder AED. Breng de AED.</p>
      <p v-else-if="mode === 'all'" class="note warn gap-top">
        <template v-if="firstTeam">{{ firstTeam }} reageerde niet op tijd of kan niet. </template><strong>Wie het eerst accepteert, gaat.</strong>
      </p>

      <div v-if="mode === 'call' && store.pkg" class="map">
        <EventMap :pkg="store.pkg" :posts="[post]" :focus-post-id="post.id" :alert-post-ids="[post.id]" whole-route :interactive="false" />
      </div>

      <div class="facts gap-top" :style="{ '--facts': mode === 'all' ? 2 : 3 }">
        <div class="fact"><span class="label">{{ mode === 'all' ? 'Jouw afstand' : 'Afstand' }}</span><span class="value">{{ km !== null ? `${formatKm(km)} km` : '–' }}</span></div>
        <div class="fact"><span class="label">Reistijd</span><span class="value">{{ minutes ? `± ${minutes} min` : '–' }}</span></div>
        <div v-if="mode === 'call'" class="fact"><span class="label">Km-punt</span><span class="value">{{ post.km !== null ? formatKm(post.km) : '–' }}</span></div>
      </div>

      <ActivityLog v-if="mode === 'call'" :entries="incidentLog(incident)" />
      <div v-else class="list others gap-top">
        <span class="small others-label">Ook opgeroepen</span>
        <div v-for="o in others" :key="o.name" class="list-row">
          <span class="dot" :class="o.state" /><span class="grow">{{ o.name }}<template v-if="o.kind === 'mobile'"> · mobiel</template></span>
          <span class="small">{{ o.state === 'declined' ? 'kan niet' : o.state === 'accepted' ? 'gaat' : o.km !== null ? `${formatKm(o.km)} km` : 'geen reactie' }}</span>
        </div>
        <div class="list-row"><span class="dot coordinator" /><span class="grow">Coördinator</span><span class="small">kijkt mee</span></div>
      </div>

      <div class="grow" />
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div class="stack gap-10 bottom">
        <button class="btn go" :disabled="busy" @click="accept"><Icon name="navigate" :size="20" />{{ mode === 'all' ? 'Ik ga · accepteren' : 'Accepteren & navigeren' }}</button>
        <div class="btn-pair">
          <a v-if="contact" :href="telHref(contact.phone)" class="btn">Bel locatie</a>
          <button class="btn" :disabled="busy" @click="decline">Kan niet</button>
        </div>
      </div>
    </template>

    <!-- 4.7 · Onderweg → ter plaatse -->
    <template v-else-if="mode === 'enroute'">
      <StatusBlock
        tone="red"
        :label="incident.status === 'ter_plaatse' ? `Ter plaatse · sinds ${clock(incident.onSiteAt)}` : `Onderweg · sinds ${clock(myDispatch?.acceptedAt)}`"
        :title="post.name"
      />
      <div v-if="store.pkg" class="map small-map">
        <EventMap :pkg="store.pkg" :posts="[post]" :focus-post-id="post.id" :alert-post-ids="[post.id]" :lines="lines" whole-route />
      </div>
      <div v-if="post.accessRoute" class="card route">
        <span class="small">Aanrijroute</span>
        <span>{{ post.accessRoute }}</span>
      </div>
      <!-- The same pair as on the post details: call on the left, navigate on the right. -->
      <div class="actions gap-top">
        <a v-if="contact" :href="telHref(contact.phone)" class="btn big"><Icon name="phone" :size="20" />Bel locatie</a>
        <a v-if="navUrl" :href="navUrl" class="btn primary"><Icon name="navigate" :size="20" />Navigeer</a>
      </div>
      <!-- Everything the post entered, also on site. -->
      <div class="card details gap-top" :class="{ fresh }">
        <div v-if="fresh" class="fresh-row">
          <span class="new-chip">Nieuw · aangevuld {{ clock(added) }}</span>
          <button class="btn link seen" @click="markSeen">Gezien</button>
        </div>
        <dl>
          <div><dt>Wat</dt><dd>{{ incident.what ? INCIDENT_WHAT[incident.what] : 'Niet ingevuld' }}</dd></div>
          <div><dt>Personen</dt><dd>{{ personsText(incident.persons) ?? 'Niet ingevuld' }}</dd></div>
          <div><dt>Aanspreekbaar</dt><dd :class="{ alarm: incident.responsive === 'nee' }">{{ incident.responsive ? RESPONSIVE[incident.responsive] : 'Niet ingevuld' }}</dd></div>
          <div v-if="incident.note"><dt>Notitie</dt><dd>{{ incident.note }}</dd></div>
          <div><dt>Gemeld</dt><dd class="mono">{{ clock(incident.reportedAt) }}<template v-if="added"> · aangevuld {{ clock(added) }}</template></dd></div>
        </dl>
      </div>
      <p v-if="incident.aed" class="note warn gap-top"><strong>Niet aanspreekbaar.</strong>{{ myTeam?.hasAed ? ' AED meenemen.' : '' }} Is 112 gebeld?</p>

      <div class="grow" />
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div class="stack gap-8 bottom">
        <button v-if="incident.status === 'geaccepteerd'" class="btn go" :disabled="busy" @click="onSite">
          <Icon name="pin" :size="20" />Ik ben ter plaatse
        </button>
        <RouterLink v-else :to="{ name: 'afronden', params: { id: incident.id } }" class="btn go"><Icon name="check" :size="20" />Incident afronden</RouterLink>
      </div>
    </template>

    <!-- 4.5 · Al aangenomen, en de andere afloopjes -->
    <template v-else>
      <div class="done-top">
        <span class="done-icon" :class="{ grey: mode === 'withdrawn' || mode === 'declined' }"><Icon :name="mode === 'withdrawn' ? 'close' : 'check'" :size="36" /></span>
        <h1 class="title">{{
          mode === 'withdrawn' ? 'Melding ingetrokken' : mode === 'declined' ? 'Je kunt niet' : mode === 'watching' ? 'Andere eenheden zijn opgeroepen' : mode === 'closed' ? 'Oproep afgerond' : 'Oproep is al aangenomen'
        }}</h1>
        <p class="lead">
          <template v-if="mode === 'withdrawn'">{{ post.name }} heeft geen hulp meer nodig.</template>
          <template v-else-if="mode === 'declined'">De oproep is naar alle beschikbare eenheden gegaan.</template>
          <template v-else-if="mode === 'watching'">Je eenheid is nu niet opgeroepen.</template>
          <template v-else-if="mode === 'closed'">{{ takenBy?.name }} heeft de oproep afgerond.</template>
          <template v-else><strong>{{ takenBy?.name }}</strong> gaat naar {{ post.name }}.<br>Je hoeft niet te komen.</template>
        </p>
      </div>
      <div class="list gap-top-lg">
        <div v-if="incident.acceptedAt" class="list-row"><span class="grow muted">Aangenomen</span><span class="mono">{{ clock(incident.acceptedAt) }}</span></div>
        <div v-if="myTeamId !== null" class="list-row">
          <span class="grow muted">Jouw status</span>
          <strong class="free">{{ live.teamState(myTeamId)?.availability === 'available' ? 'Weer beschikbaar' : live.teamState(myTeamId)?.availability === 'unavailable' ? 'Niet beschikbaar (pauze)' : 'Uit dienst' }}</strong>
        </div>
      </div>
      <div class="grow" />
      <button class="btn primary" @click="toEhbo">Terug naar EHBO</button>
      <a v-if="mode === 'taken' && incident.acceptedBy" :href="telHref(incident.acceptedBy.phone)" class="btn link">Toch helpen? Bel {{ takenBy?.name }}</a>
    </template>
  </main>
</template>

<style scoped>
.top-gap { margin-top: 24px; }
.gap-top { margin-top: 12px; }
.gap-top-lg { margin-top: 32px; }
.all-chip { background: #FFFFFF; color: var(--danger); padding: 4px 10px; border-radius: 999px; font-size: 12px; }
.ring { position: relative; width: 64px; height: 64px; flex-shrink: 0; }
.ring-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
.ring-text .mono { font-size: 20px; }
.sec { font-size: 10px; margin-top: 2px; }
.what { font-size: 15px; }
.details { display: flex; flex-direction: column; gap: 8px; font-size: 15px; }
.details.fresh { box-shadow: 0 0 0 2px var(--warn-line); }
.details dl { display: flex; flex-direction: column; gap: 6px; margin: 0; }
.details dl div { display: flex; gap: 12px; }
.details dt { width: 112px; flex-shrink: 0; color: var(--muted); font-size: 13px; padding-top: 2px; }
.details dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
.details dd.alarm { color: var(--danger); }
.fresh-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.new-chip { background: var(--warn-line); color: var(--ink); padding: 4px 10px; border-radius: 999px; font-size: 12px; font-weight: 700; }
.seen { min-height: 44px; padding: 0 8px; }
.map { margin-top: 14px; height: 190px; border-radius: 16px; overflow: hidden; }
.small-map { height: clamp(150px, 22dvh, 260px); }
.actions { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; }
/* Twee knoppen naast elkaar zijn altijd even hoog. */
.btn.big { height: 56px; font-size: 16px; }
.route { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; font-size: 14px; line-height: 1.45; }
.others { padding: 0 14px; }
.others-label { display: block; padding-top: 10px; }
.others .list-row { padding: 0; min-height: 44px; font-size: 14px; }
.dot { width: 10px; height: 10px; flex-shrink: 0; border-radius: 50%; background: var(--warn-line); }
.dot.declined { background: #A8A59C; }
.dot.accepted { background: var(--ok); }
.dot.coordinator { background: var(--primary); }
.bottom { padding-top: 12px; }
.done-top { padding-top: 96px; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
.done-icon { width: 80px; height: 80px; border-radius: 50%; background: var(--ok-bg); color: var(--ok); display: flex; align-items: center; justify-content: center; }
.done-icon.grey { background: var(--soft); color: var(--muted); }
.muted { color: var(--muted); }
.free { color: var(--ok-text); }
</style>
