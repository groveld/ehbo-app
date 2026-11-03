<script setup lang="ts">
// 3.4 · Overzicht & kaart: alle posten en EHBO-teams, filter per soort en route, zoeken op naam of km, tellers voor de coördinator, en de lijst met bel- en navigeerknoppen.
import { computed, defineAsyncComponent, onBeforeUnmount, onMounted, ref, shallowRef, watch, watchEffect } from 'vue';
import { QUIET_AFTER_MIN, isDueOpen, lacksPosition, type EventPackage, type LastSeen, type LngLat, type PackagePost } from '@ehbo/shared';
import { api } from '../../api.ts';
import { useRouter } from 'vue-router';
import Icon from '../../components/Icon.vue';
import PostRow from '../../components/PostRow.vue';
import TeamRow from '../../components/TeamRow.vue';
import { clock } from '../../incidents.ts';
import { callLines, coordinatorOf, isOnRun, manned, mobileTeams, type Ambulance } from '../../posts.ts';
import { useLiveStore } from '../../stores/live.ts';
import { usePackageStore } from '../../stores/package.ts';
import { useSessionStore } from '../../stores/session.ts';

// The map library is large: the screen doesn't wait for it.
const EventMap = defineAsyncComponent(() => import('../../components/EventMap.vue'));

/** The tab is in view. Out of view the map stays in memory but does nothing. */
const props = defineProps<{ active: boolean }>();

const store = usePackageStore();
const live = useLiveStore();
const session = useSessionStore();
const router = useRouter();
/** A type of post, only the EHBO teams, or only what needs attention. */
const filter = ref<number | 'teams' | 'attention' | null>(null);
/** The route shown on the map; only runs with a GPX can be chosen. */
const route = ref<number | null>(null);
const routes = computed(() => store.pkg?.runs.filter((r) => r.line) ?? []);
const query = ref('');

/** Per soort het aantal posten; soorten zonder posten laten we weg. */
const chips = computed(() => {
  const pkg = store.pkg;
  if (!pkg) return [];
  return pkg.postTypes
    .map((t) => ({ id: t.id, label: t.name.replace(/-?post$/i, ''), count: pkg.posts.filter((p) => p.functionIds.includes(t.id)).length }))
    .filter((c) => c.count > 0);
});
/** Posten met een open oproep rood en bovenaan. */
const alertIds = computed(() => [...new Set(live.openIncidents.filter((i) => !i.offPost).map((i) => i.postId))]);
/** Posts with a request that's still open. */
const taskIds = computed(() => [...new Set(live.requests.filter((r) => r.status === 'sent' || r.status === 'accepted').map((r) => r.postId))]);
/** Mobiele EHBO onderweg als ambulance; haar standplaats dan grijs. */
const mobile = computed(() => mobileTeams(store.pkg, live.teams, live.serverNow));
/** Only locations with people can be open or closed (#69). */
const mannedPosts = computed(() => store.pkg?.posts.filter((p) => manned(store.pkg, p)) ?? []);
const closedIds = computed(() => mannedPosts.value.filter((p) => !live.postOpen(p.id, p.isOpen)).map((p) => p.id));
const matches = (p: PackagePost) => {
  const q = query.value.trim().toLowerCase().replace(',', '.');
  const km = q.replace(/^km\s*/, '');
  return !q || p.name.toLowerCase().includes(q) || p.passages.some((r) => r.km.some((k) => String(Math.round(k * 10) / 10).startsWith(km)));
};
/** On the map; what isn't on the chosen route steps back there. */
const mapPosts = computed(() => store.pkg?.posts.filter((p) => (typeof filter.value !== 'number' || p.functionIds.includes(filter.value)) && matches(p)) ?? []);
/** In the list: only the chosen route, in its order. Open calls always stay, on top. */
const routeKm = (p: PackagePost) => p.passages.find((r) => r.runId === route.value)?.km[0] ?? Infinity;
const helpHere = computed(() => !session.me?.assignments.some((a) => a.kind === 'team'));
const isLead = computed(() => Boolean(session.me?.isAdmin || coordinatorOf(store.pkg)?.phone === session.me?.phone));
/** For the coordinator: a post that should be open by now, and a team nobody can locate. */
const latePosts = computed(() => {
  const pkg = store.pkg;
  if (!pkg || !isLead.value) return [];
  return pkg.posts.filter((p) => closedIds.value.includes(p.id) && isDueOpen(p, pkg.event, live.serverNow)).map((p) => p.id);
});
const lostTeams = computed(() => (isLead.value ? store.pkg?.teams.filter((u) => live.teamState(u.id)?.incidentId == null && lacksPosition(u, live.teamState(u.id), live.serverNow)).map((u) => u.id) ?? [] : []));
/** No contact for a while. Only a signal for the coordinator: a phone in a pocket has no connection either, so nothing closes by this. */
const lastSeen = ref<LastSeen | null>(null);
async function loadLastSeen() {
  if (!props.active || !isLead.value || document.visibilityState !== 'visible') return;
  try {
    lastSeen.value = await api<LastSeen>('/api/live/last-seen', { timeoutMs: 8_000 });
  } catch {
    // Geen bereik: de vorige stand blijft staan.
  }
}
let seenTimer: ReturnType<typeof setInterval> | undefined;
onMounted(() => {
  void loadLastSeen();
  seenTimer = setInterval(loadLastSeen, 60_000);
});
onBeforeUnmount(() => clearInterval(seenTimer));
watch(() => props.active, () => void loadLastSeen());
const quietMinutes = (at: string | null | undefined) => {
  if (at === undefined || at === null) return null;
  const minutes = Math.floor((live.serverNow - new Date(at).getTime()) / 60_000);
  return minutes >= QUIET_AFTER_MIN ? minutes : null;
};
const quietPost = (id: number) => (lastSeen.value && !closedIds.value.includes(id) ? quietMinutes(lastSeen.value.posts[id]) : null);
const quietTeam = (id: number) => (lastSeen.value ? quietMinutes(lastSeen.value.teams[id]) : null);
const posts = computed(() => {
  const pkg = store.pkg;
  const shown = filter.value === 'attention' ? mapPosts.value.filter((p) => alertIds.value.includes(p.id) || latePosts.value.includes(p.id) || quietPost(p.id)) : mapPosts.value;
  const list = route.value === null || !pkg ? shown : shown
    .filter((p) => alertIds.value.includes(p.id) || isOnRun(pkg, p, route.value!))
    .sort((a, b) => routeKm(a) - routeKm(b));
  return [...list].sort((a, b) => Number(alertIds.value.includes(b.id)) - Number(alertIds.value.includes(a.id)));
});
const teamList = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (typeof filter.value === 'number') return [];
  return store.pkg?.teams.filter((u) => (!q || u.name.toLowerCase().includes(q)) && (filter.value !== 'attention' || lostTeams.value.includes(u.id) || quietTeam(u.id))) ?? [];
});
/** How the event is doing, for the coordinator and admins. */
const counters = computed(() => {
  const pkg = store.pkg;
  if (!pkg || !isLead.value) return null;
  const free = pkg.teams.filter((u) => {
    const state = live.teamState(u.id);
    return state?.availability === 'available' && state.incidentId === null;
  });
  return [
    { label: 'Locaties', value: `${mannedPosts.value.length - closedIds.value.length}/${mannedPosts.value.length}`, full: 'Locaties open' },
    { label: 'EHBO', value: `${free.length}/${pkg.teams.length}`, full: 'EHBO beschikbaar' },
    { label: 'Oproepen', value: String(live.openIncidents.length), full: 'Open oproepen' },
    { label: 'Aanvragen', value: String(live.requests.filter((r) => r.status === 'sent').length), full: 'Aanvragen nog niet opgepakt' },
  ];
});
/** What the map shows. Out of view none of this is read, so nothing live reaches the map; opening the tab brings it up to date in one go. */
const mapView = shallowRef<{ pkg: EventPackage; posts: PackagePost[]; highlightRunId: number | null; alertPostIds: number[]; taskPostIds: number[]; lines: [LngLat, LngLat][]; ambulances: Ambulance[]; awayPostIds: number[] } | null>(null);
watchEffect(() => {
  if ((!props.active && mapView.value) || !store.pkg) return;
  mapView.value = {
    pkg: store.pkg, posts: mapPosts.value, highlightRunId: route.value, alertPostIds: alertIds.value, taskPostIds: taskIds.value, lines: callLines(store.pkg, live.teams, live.incidents, live.serverNow), ambulances: mobile.value.ambulances, awayPostIds: mobile.value.awayPostIds,
  };
});
const banner = computed(() => {
  const open = live.openIncidents;
  if (!open.length) return null;
  const names = [...new Set(open.map((i) => i.post.name.split(' · ')[0]))].filter(Boolean);
  return `${open.length} open ${open.length === 1 ? 'oproep' : 'oproepen'} · ${names.join(', ')}`;
});
</script>

<template>
  <main class="screen tight tabbed">
    <template v-if="store.pkg">
      <div v-if="active && counters" class="facts counters">
        <div v-for="c in counters" :key="c.label" class="fact" :aria-label="`${c.full}: ${c.value}`">
          <span class="value mono">{{ c.value }}</span><span class="label">{{ c.label }}</span>
        </div>
      </div>
      <div class="map">
        <EventMap v-if="mapView" v-bind="mapView" :paused="!active" @select="(id) => router.push({ name: 'post', params: { id } })" />
        <RouterLink v-if="active && banner" :to="{ name: 'requests' }" class="banner"><Icon name="bell" :size="16" />{{ banner }}</RouterLink>
      </div>

      <!-- Zoeken en filteren op één regel: het zoekveld, en rechts de soort post. -->
      <div v-if="active && store.pkg.posts.length" class="find">
        <label class="search">
          <Icon name="search" :size="18" />
          <input v-model="query" class="input" type="search" placeholder="Zoek locatie of km" aria-label="Zoek een locatie">
        </label>
        <select v-model="filter" class="input type" aria-label="Functie">
          <option :value="null">Alle</option>
          <option v-for="c in chips" :key="c.id" :value="c.id">{{ c.label }}</option>
          <option v-if="store.pkg.teams.length" value="teams">EHBO</option>
          <option v-if="isLead" value="attention">Vraagt aandacht</option>
        </select>
        <select v-if="routes.length" v-model="route" class="input route" :class="{ chosen: route !== null }" aria-label="Route">
          <option :value="null">Alle routes</option>
          <option v-for="r in routes" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
        <RouterLink v-if="route !== null" :to="{ name: 'route', params: { id: route } }" class="btn route-info"><Icon name="info" :size="18" />Route-info</RouterLink>
      </div>

      <div v-if="active" class="stack gap-14">
        <section v-if="teamList.length" class="stack gap-8">
          <h2 class="section-title">EHBO<template v-if="!live.connected && live.state"> · laatste stand {{ clock(live.state.serverTime) }}</template></h2>
          <div class="list"><TeamRow v-for="u in teamList" :key="u.id" :pkg="store.pkg" :team="u" :attention="lostTeams.includes(u.id)" :quiet-minutes="quietTeam(u.id)" /></div>
        </section>
        <template v-if="filter !== 'teams'">
          <section v-if="posts.length" class="stack gap-8">
            <h2 class="section-title">Locaties</h2>
            <div class="list"><PostRow v-for="p in posts" :key="p.id" :pkg="store.pkg" :post="p" :alert="alertIds.includes(p.id)" :open="!closedIds.includes(p.id)" :late="latePosts.includes(p.id)" :quiet-minutes="quietPost(p.id)" /></div>
          </section>
          <p v-if="!store.pkg.posts.length" class="note">Er zijn nog geen locaties ingevoerd.</p>
          <p v-else-if="!posts.length && !teamList.length" class="note">{{ filter === 'attention' ? 'Niets vraagt nu aandacht.' : 'Geen locatie gevonden.' }}</p>
        </template>
      </div>
    </template>
    <p v-else class="note">Geen bereik, en de gegevens van het evenement staan nog niet op deze telefoon. Probeer het opnieuw met internet.</p>
    <!-- Help to where you are (#102). An EHBO team starts an incident itself instead. -->
    <RouterLink v-if="active && helpHere" :to="{ name: 'help' }" class="help-here"><Icon name="ehbo" :size="24" />EHBO hierheen</RouterLink>
  </main>
</template>

<style scoped>
.counters { --facts: 4; margin-bottom: 10px; }
.help-here {
  position: fixed; z-index: 10; right: max(16px, calc((100% - 720px) / 2 + 16px)); bottom: calc(var(--tabbar) + 12px);
  height: 56px; padding: 0 18px 0 14px; border-radius: 16px; background: var(--danger); box-shadow: 0 4px 12px rgba(0, 0, 0, .3);
  display: flex; align-items: center; gap: 8px; color: #FFFFFF; font-size: 16px; font-weight: 700; white-space: nowrap; text-decoration: none;
}
.counters .fact { padding: 8px 6px; align-items: center; min-width: 0; }
.counters .label { font-size: 11px; }
.map { position: relative; height: clamp(240px, 40dvh, 480px); }
.banner {
  position: absolute; left: 12px; top: 12px; right: 12px; z-index: 2; display: flex; align-items: center; gap: 8px; width: fit-content; max-width: calc(100% - 24px);
  padding: 8px 12px; border-radius: 12px; background: var(--danger); color: #FFFFFF; font-size: 13px; font-weight: 600; text-decoration: none;
}
.find { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin: 12px 0; }
.search { position: relative; display: block; color: var(--muted); }
.search svg { position: absolute; left: 12px; top: 13px; }
.search .input { padding-left: 38px; }
.route { grid-column: 1 / -1; appearance: auto; font-size: 14px; font-weight: 600; }
.route.chosen { grid-column: auto; }
.route-info { height: 44px; }
.type { width: auto; max-width: 130px; padding: 0 8px 0 12px; appearance: auto; font-size: 14px; font-weight: 600; }
</style>
