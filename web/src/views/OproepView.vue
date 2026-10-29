<script setup lang="ts">
// EHBO: 4.3 · oproep (aftellen), 4.4 · naar alle eenheden, 4.5 · al aangenomen, 4.7 · onderweg → ter plaatse.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { formatKm, telHref } from '@ehbo/shared';
import EventMap from '../components/EventMap.vue';
import Icon from '../components/Icon.vue';
import StatusBlock from '../components/StatusBlock.vue';
import { useSave } from '../composables/useSave.ts';
import { clock, incidentSummary, travelMinutes, unitOf } from '../incidents.ts';
import { navigationUrl } from '../navigate.ts';
import { primaryContact } from '../posts.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();
const { busy, error, run } = useSave();

/** Omtrek van de aftelring (r = 30). */
const RING = 2 * Math.PI * 30;

const incident = computed(() => live.incidentById(Number(props.id)));
const post = computed(() => (incident.value ? store.postById.get(incident.value.postId) : undefined));
const contact = computed(() => (post.value ? primaryContact(post.value) : null));

/** Mijn eenheid voor deze oproep: die is opgeroepen of heeft aangenomen; anders mijn eerste eenheid. */
const myDispatch = computed(() => incident.value?.dispatches.find((d) => live.myUnitIds.includes(d.unitId)) ?? null);
const myUnitId = computed(() => myDispatch.value?.unitId ?? live.myUnitIds[0] ?? null);
const myUnit = computed(() => unitOf(store.pkg, myUnitId.value));

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
const minutes = computed(() => travelMinutes(km.value, myUnit.value));
const takenBy = computed(() => unitOf(store.pkg, incident.value?.unitId ?? null));
/** Na accepteren zonder AED: een eenheid met AED is nog nodig. */
const aedCall = computed(() => mode.value === 'call' && incident.value?.status !== 'verstuurd');
const firstUnit = computed(() => {
  const first = incident.value?.dispatches.find((d) => d.reason === 'dichtstbij');
  return first ? unitOf(store.pkg, first.unitId)?.name : null;
});
const others = computed(() => (incident.value?.dispatches ?? []).filter((d) => d.unitId !== myUnitId.value).map((d) => ({
  name: unitOf(store.pkg, d.unitId)?.name ?? 'Eenheid',
  kind: unitOf(store.pkg, d.unitId)?.kind,
  state: d.acceptedAt ? 'accepted' : d.declinedAt ? 'declined' : 'pending',
  km: d.distanceKm,
})));
const navUrl = computed(() => (post.value?.lat != null && post.value.lng != null ? navigationUrl(post.value.lat, post.value.lng, post.value.name) : null));

async function accept() {
  if (!incident.value || myUnitId.value === null) return;
  if (await run(() => live.accept(incident.value!.id, myUnitId.value!)) && navUrl.value) location.href = navUrl.value;
}
async function decline() {
  if (!incident.value || myUnitId.value === null) return;
  await run(() => live.decline(incident.value!.id, myUnitId.value!));
}
const toStandby = () => router.replace({ name: 'stand-by' });
</script>

<template>
  <main class="screen tight">
    <template v-if="mode === 'missing' || !incident || !post">
      <p class="note warn top-gap">Deze oproep staat (nog) niet op deze telefoon. <button class="add-link" @click="live.refresh()">Opnieuw laden</button></p>
      <div class="grow" />
      <button class="btn primary" @click="toStandby">Terug naar stand-by</button>
    </template>

    <!-- 4.3 · Oproep, en 4.4 · naar alle eenheden -->
    <template v-else-if="mode === 'call' || mode === 'all'">
      <StatusBlock
        tone="red" :label="mode === 'all' ? '' : aedCall ? 'AED nodig' : `Oproep · ${myUnit?.name ?? ''}`" :title="post.name"
        :sub="mode === 'all' ? `${incidentSummary(incident)} · gemeld ${clock(incident.reportedAt)}` : incidentSummary(incident)"
      >
        <template v-if="mode === 'all'" #label><span class="all-chip">Alle eenheden</span></template>
        <div v-if="mode === 'call' && left !== null" class="ring">
          <svg width="72" height="72" viewBox="0 0 72 72" role="img" :aria-label="`Nog ${left} seconden om te reageren`">
            <circle cx="36" cy="36" r="30" fill="none" stroke="#FFFFFF" stroke-opacity="0.3" stroke-width="6" />
            <circle
              cx="36" cy="36" r="30" fill="none" stroke="#FFFFFF" stroke-width="6" stroke-linecap="round"
              :stroke-dasharray="`${(left / totalSeconds) * RING} ${RING}`" transform="rotate(-90 36 36)"
            />
          </svg>
          <span class="ring-text"><span class="mono">{{ left }}</span><span class="sec">sec</span></span>
        </div>
      </StatusBlock>

      <p v-if="incident.aed && myUnit?.hasAed" class="note warn gap-top"><strong>AED meenemen.</strong> De persoon is niet aanspreekbaar.</p>
      <p v-if="aedCall" class="note warn gap-top">{{ takenBy?.name }} is onderweg zonder AED. Breng de AED.</p>
      <p v-else-if="mode === 'all'" class="note warn gap-top">
        <template v-if="firstUnit">{{ firstUnit }} reageerde niet op tijd of kan niet. </template><strong>Wie het eerst accepteert, gaat.</strong>
      </p>

      <div v-if="mode === 'call' && store.pkg" class="map">
        <EventMap :pkg="store.pkg" :posts="[post]" :focus-post-id="post.id" :interactive="false" />
      </div>

      <div class="facts gap-top" :style="{ '--facts': mode === 'all' ? 2 : 3 }">
        <div class="fact"><span class="label">{{ mode === 'all' ? 'Jouw afstand' : 'Afstand' }}</span><span class="value">{{ km !== null ? `${formatKm(km)} km` : '–' }}</span></div>
        <div class="fact"><span class="label">Reistijd</span><span class="value">{{ minutes ? `± ${minutes} min` : '–' }}</span></div>
        <div v-if="mode === 'call'" class="fact"><span class="label">Km-punt</span><span class="value">{{ post.km !== null ? formatKm(post.km) : '–' }}</span></div>
      </div>

      <div v-if="mode === 'call'" class="card timeline gap-top">
        <div v-for="(e, n) in incident.events" :key="n" class="row" :class="{ warn: e.type === 'geescaleerd' || e.type === 'herhaald' }">
          <span class="at">{{ clock(e.at) }}</span><span>{{ e.text }}</span>
        </div>
      </div>
      <div v-else class="list others gap-top">
        <span class="small others-label">Ook opgeroepen</span>
        <div v-for="o in others" :key="o.name" class="list-row">
          <span class="dot" :class="o.state" /><span class="grow">{{ o.name }}<template v-if="o.kind === 'mobiel'"> · mobiel</template></span>
          <span class="small">{{ o.state === 'declined' ? 'kan niet' : o.state === 'accepted' ? 'gaat' : o.km !== null ? `${formatKm(o.km)} km` : 'geen reactie' }}</span>
        </div>
        <div class="list-row"><span class="dot coordinator" /><span class="grow">Coördinator</span><span class="small">kijkt mee</span></div>
      </div>

      <div class="grow" />
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div class="stack gap-10 bottom">
        <button class="btn go" :disabled="busy" @click="accept"><Icon name="navigate" :size="20" />{{ mode === 'all' ? 'Ik ga · accepteren' : 'Accepteren & navigeren' }}</button>
        <div class="btn-pair">
          <a v-if="contact" :href="telHref(contact.phone)" class="btn">Bel de post</a>
          <button class="btn" :disabled="busy" @click="decline">Kan niet</button>
        </div>
      </div>
    </template>

    <!-- 4.7 · Onderweg → ter plaatse -->
    <template v-else-if="mode === 'enroute'">
      <StatusBlock
        tone="dark"
        :label="incident.status === 'ter_plaatse' ? `Ter plaatse · sinds ${clock(incident.onSiteAt)}` : `Onderweg · sinds ${clock(myDispatch?.acceptedAt)}`"
        :title="post.name" :sub="incidentSummary(incident)"
      />
      <p v-if="incident.aed" class="note warn gap-top"><strong>Niet aanspreekbaar.</strong>{{ myUnit?.hasAed ? ' AED meenemen.' : '' }} Is 112 gebeld?</p>
      <p v-if="incident.note" class="note gap-top">{{ incident.note }}</p>
      <div v-if="store.pkg" class="map small-map">
        <EventMap :pkg="store.pkg" :posts="[post]" :focus-post-id="post.id" :interactive="false" />
      </div>
      <div v-if="post.accessRoute" class="card route">
        <span class="small">Aanrijroute</span>
        <span>{{ post.accessRoute }}</span>
      </div>
      <div class="btn-pair gap-top">
        <a v-if="navUrl" :href="navUrl" class="btn">Navigatie openen</a>
        <a v-if="contact" :href="telHref(contact.phone)" class="btn">Bel de post</a>
      </div>

      <div class="grow" />
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <div class="stack gap-8 bottom">
        <button v-if="incident.status === 'geaccepteerd'" class="btn go" :disabled="busy" @click="run(() => live.onSite(incident!.id))">
          <Icon name="pin" :size="20" />Ik ben ter plaatse
        </button>
        <RouterLink v-else :to="{ name: 'afronden', params: { id: incident.id } }" class="btn go"><Icon name="check" :size="20" />Incident afronden</RouterLink>
        <span class="small center">De post en de coördinator zien dit direct</span>
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
          <template v-else-if="mode === 'declined'">De oproep is naar alle vrije eenheden gegaan.</template>
          <template v-else-if="mode === 'watching'">Je eenheid is nu niet opgeroepen.</template>
          <template v-else-if="mode === 'closed'">{{ takenBy?.name }} heeft de oproep afgerond.</template>
          <template v-else><strong>{{ takenBy?.name }}</strong> gaat naar {{ post.name }}.<br>Je hoeft niet te komen.</template>
        </p>
      </div>
      <div class="list gap-top-lg">
        <div v-if="incident.acceptedAt" class="list-row"><span class="grow muted">Aangenomen</span><span class="mono">{{ clock(incident.acceptedAt) }}</span></div>
        <div v-if="myUnitId !== null" class="list-row">
          <span class="grow muted">Jouw status</span>
          <strong class="free">{{ live.unitState(myUnitId)?.availability === 'vrij' ? 'Weer vrij' : live.unitState(myUnitId)?.availability === 'pauze' ? 'Even pauze' : 'Uit dienst' }}</strong>
        </div>
      </div>
      <div class="grow" />
      <button class="btn primary" @click="toStandby">Terug naar stand-by</button>
      <a v-if="mode === 'taken' && incident.acceptedBy" :href="telHref(incident.acceptedBy.phone)" class="btn link">Toch helpen? Bel {{ takenBy?.name }}</a>
    </template>
  </main>
</template>

<style scoped>
.top-gap { margin-top: 24px; }
.gap-top { margin-top: 12px; }
.gap-top-lg { margin-top: 32px; }
.all-chip { background: #FFFFFF; color: var(--danger); padding: 4px 10px; border-radius: 999px; font-size: 12px; }
.ring { position: relative; width: 72px; height: 72px; flex-shrink: 0; }
.ring-text { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; line-height: 1; }
.ring-text .mono { font-size: 22px; }
.sec { font-size: 10px; margin-top: 2px; }
.map { margin-top: 14px; height: 190px; border-radius: 16px; overflow: hidden; }
.small-map { height: clamp(150px, 22dvh, 260px); }
.route { display: flex; flex-direction: column; gap: 4px; margin-top: 10px; font-size: 14px; line-height: 1.45; }
.others { padding: 0 14px; }
.others-label { display: block; padding-top: 10px; }
.others .list-row { padding: 0; min-height: 44px; font-size: 14px; }
.dot { width: 10px; height: 10px; flex-shrink: 0; border-radius: 50%; background: var(--warn-line); }
.dot.declined { background: #A8A59C; }
.dot.accepted { background: var(--ok); }
.dot.coordinator { background: var(--primary); }
.bottom { padding-top: 12px; }
.center { text-align: center; }
.done-top { padding-top: 96px; display: flex; flex-direction: column; align-items: center; gap: 18px; text-align: center; }
.done-icon { width: 80px; height: 80px; border-radius: 50%; background: var(--ok-bg); color: var(--ok); display: flex; align-items: center; justify-content: center; }
.done-icon.grey { background: var(--soft); color: var(--muted); }
.muted { color: var(--muted); }
.free { color: var(--ok-text); }
</style>
