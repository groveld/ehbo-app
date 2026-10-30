<script setup lang="ts">
// 3.4 · Overzicht & kaart: alle posten en EHBO-teams, filter per soort en route, zoeken op naam of km, tellers voor de coördinator, en de lijst met bel- en navigeerknoppen.
import { computed, ref } from 'vue';
import { isDueOpen, lacksPosition, type PackagePost } from '@ehbo/shared';
import { useRouter } from 'vue-router';
import EventMap from '../../components/EventMap.vue';
import Icon from '../../components/Icon.vue';
import PostRow from '../../components/PostRow.vue';
import TeamRow from '../../components/TeamRow.vue';
import { clock } from '../../incidents.ts';
import { coordinatorOf, isOnRun, mobileUnits } from '../../posts.ts';
import { useLiveStore } from '../../stores/live.ts';
import { usePackageStore } from '../../stores/package.ts';
import { useSessionStore } from '../../stores/session.ts';

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
    .map((t) => ({ id: t.id, label: t.name.replace(/-?post$/i, ''), count: pkg.posts.filter((p) => p.typeId === t.id).length }))
    .filter((c) => c.count > 0);
});
/** Posten met een open oproep rood en bovenaan; dichte posten grijs op de kaart. */
const alertIds = computed(() => [...new Set(live.openIncidents.map((i) => i.postId))]);
/** Mobiele EHBO onderweg als ambulance; haar standplaats dan grijs. */
const mobile = computed(() => mobileUnits(store.pkg, live.state?.units ?? [], live.serverNow));
const closedIds = computed(() => store.pkg?.posts.filter((p) => !live.postOpen(p.id, p.isOpen)).map((p) => p.id) ?? []);
const matches = (p: PackagePost) => {
  const q = query.value.trim().toLowerCase().replace(',', '.');
  const km = q.replace(/^km\s*/, '');
  return !q || p.name.toLowerCase().includes(q) || p.passages.some((r) => r.km.some((k) => String(k).startsWith(km)));
};
/** On the map; what isn't on the chosen route steps back there. */
const mapPosts = computed(() => store.pkg?.posts.filter((p) => (typeof filter.value !== 'number' || p.typeId === filter.value) && matches(p)) ?? []);
/** In the list: only the chosen route, in its order. Open calls always stay, on top. */
const routeKm = (p: PackagePost) => p.passages.find((r) => r.runId === route.value)?.km[0] ?? Infinity;
const isLead = computed(() => Boolean(session.me?.isAdmin || coordinatorOf(store.pkg)?.phone === session.me?.phone));
/** For the coordinator: a post that should be open by now, and a team nobody can locate. */
const latePosts = computed(() => {
  const pkg = store.pkg;
  if (!pkg || !isLead.value) return [];
  return pkg.posts.filter((p) => closedIds.value.includes(p.id) && isDueOpen(p, pkg.event, live.serverNow)).map((p) => p.id);
});
const lostTeams = computed(() => (isLead.value ? store.pkg?.units.filter((u) => live.unitState(u.id)?.incidentId == null && lacksPosition(u, live.unitState(u.id), live.serverNow)).map((u) => u.id) ?? [] : []));
const posts = computed(() => {
  const pkg = store.pkg;
  const shown = filter.value === 'attention' ? mapPosts.value.filter((p) => alertIds.value.includes(p.id) || latePosts.value.includes(p.id)) : mapPosts.value;
  const list = route.value === null || !pkg ? shown : shown
    .filter((p) => alertIds.value.includes(p.id) || isOnRun(pkg, p, route.value!))
    .sort((a, b) => routeKm(a) - routeKm(b));
  return [...list].sort((a, b) => Number(alertIds.value.includes(b.id)) - Number(alertIds.value.includes(a.id)));
});
const teams = computed(() => {
  const q = query.value.trim().toLowerCase();
  if (typeof filter.value === 'number') return [];
  return store.pkg?.units.filter((u) => (!q || u.name.toLowerCase().includes(q)) && (filter.value !== 'attention' || lostTeams.value.includes(u.id))) ?? [];
});
/** How the event is doing, for the coordinator and admins. */
const counters = computed(() => {
  const pkg = store.pkg;
  if (!pkg || !isLead.value) return null;
  const free = pkg.units.filter((u) => {
    const state = live.unitState(u.id);
    return state?.availability === 'vrij' && state.incidentId === null;
  });
  return [
    { label: 'Posten', value: `${pkg.posts.length - closedIds.value.length}/${pkg.posts.length}`, full: 'Posten open' },
    { label: 'EHBO', value: `${free.length}/${pkg.units.length}`, full: 'EHBO beschikbaar' },
    { label: 'Oproepen', value: String(live.openIncidents.length), full: 'Open oproepen' },
    { label: 'Aanvragen', value: String(live.requests.filter((r) => r.status === 'aangevraagd').length), full: 'Aanvragen nog niet opgepakt' },
  ];
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
      <div v-if="counters" class="facts counters">
        <div v-for="c in counters" :key="c.label" class="fact" :aria-label="`${c.full}: ${c.value}`">
          <span class="value mono">{{ c.value }}</span><span class="label">{{ c.label }}</span>
        </div>
      </div>
      <div class="map">
        <EventMap
          :pkg="store.pkg" :posts="mapPosts" :highlight-run-id="route" :alert-post-ids="alertIds" :closed-post-ids="closedIds"
          :ambulances="mobile.ambulances" :away-post-ids="mobile.awayPostIds"
          @select="(id) => router.push({ name: 'post', params: { id } })"
        />
        <RouterLink v-if="banner" :to="{ name: 'meldingen' }" class="banner"><Icon name="bell" :size="16" />{{ banner }}</RouterLink>
      </div>

      <!-- Zoeken en filteren op één regel: het zoekveld, en rechts de soort post. -->
      <div v-if="store.pkg.posts.length" class="find">
        <label class="search">
          <Icon name="search" :size="18" />
          <input v-model="query" class="input" type="search" placeholder="Zoek post of km" aria-label="Zoek een post">
        </label>
        <select v-model="filter" class="input type" aria-label="Soort post">
          <option :value="null">Alle</option>
          <option v-for="c in chips" :key="c.id" :value="c.id">{{ c.label }}</option>
          <option v-if="store.pkg.units.length" value="teams">EHBO</option>
          <option v-if="isLead" value="attention">Vraagt aandacht</option>
        </select>
        <select v-if="routes.length" v-model="route" class="input route" aria-label="Route">
          <option :value="null">Alle routes</option>
          <option v-for="r in routes" :key="r.id" :value="r.id">{{ r.name }}</option>
        </select>
      </div>

      <div class="stack gap-14">
        <section v-if="teams.length" class="stack gap-8">
          <h2 class="section-title">EHBO<template v-if="!live.connected && live.state"> · laatste stand {{ clock(live.state.serverTime) }}</template></h2>
          <div class="list"><TeamRow v-for="u in teams" :key="u.id" :pkg="store.pkg" :unit="u" :attention="lostTeams.includes(u.id)" /></div>
        </section>
        <template v-if="filter !== 'teams'">
          <section v-if="posts.length" class="stack gap-8">
            <h2 class="section-title">Posten</h2>
            <div class="list"><PostRow v-for="p in posts" :key="p.id" :pkg="store.pkg" :post="p" :alert="alertIds.includes(p.id)" :open="!closedIds.includes(p.id)" :late="latePosts.includes(p.id)" /></div>
          </section>
          <p v-if="!store.pkg.posts.length" class="note">Er zijn nog geen posten ingevoerd.</p>
          <p v-else-if="!posts.length && !teams.length" class="note">{{ filter === 'attention' ? 'Niets vraagt nu aandacht.' : 'Geen post gevonden.' }}</p>
        </template>
      </div>
    </template>
    <p v-else class="note">Geen bereik, en de gegevens van het evenement staan nog niet op deze telefoon. Probeer het opnieuw met internet.</p>
  </main>
</template>

<style scoped>
.counters { --facts: 4; margin-bottom: 10px; }
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
.type { width: auto; max-width: 130px; padding: 0 8px 0 12px; appearance: auto; font-size: 14px; font-weight: 600; }
</style>
