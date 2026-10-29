<script setup lang="ts">
// 3.4 · Overzicht & kaart: alle posten op de kaart, filter per soort, zoeken op naam of km, en de lijst met bel- en navigeerknoppen.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import EventMap from '../../components/EventMap.vue';
import Icon from '../../components/Icon.vue';
import PostRow from '../../components/PostRow.vue';
import { ambulances } from '../../posts.ts';
import { useLiveStore } from '../../stores/live.ts';
import { usePackageStore } from '../../stores/package.ts';

const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();
const filter = ref<number | null>(null);
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
const closedIds = computed(() => store.pkg?.posts.filter((p) => !live.postOpen(p.id, p.isOpen)).map((p) => p.id) ?? []);
const matches = (p: { name: string; km: number | null }) => {
  const q = query.value.trim().toLowerCase().replace(',', '.');
  return !q || p.name.toLowerCase().includes(q) || (p.km !== null && String(p.km).startsWith(q.replace(/^km\s*/, '')));
};
const posts = computed(() => (store.pkg?.posts.filter((p) => (filter.value === null || p.typeId === filter.value) && matches(p)) ?? [])
  .slice().sort((a, b) => Number(alertIds.value.includes(b.id)) - Number(alertIds.value.includes(a.id))));
const banner = computed(() => {
  const open = live.openIncidents;
  if (!open.length) return null;
  const names = [...new Set(open.map((i) => store.postById.get(i.postId)?.name.split(' · ')[0]))].filter(Boolean);
  return `${open.length} open ${open.length === 1 ? 'oproep' : 'oproepen'} · ${names.join(', ')}`;
});
</script>

<template>
  <main class="screen tight tabbed">
    <template v-if="store.pkg">
      <div class="map">
        <EventMap
          :pkg="store.pkg" :posts="posts" :alert-post-ids="alertIds" :closed-post-ids="closedIds"
          :ambulances="ambulances(store.pkg, live.state?.units ?? [], live.serverNow)"
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
        </select>
      </div>

      <div class="stack gap-10">
        <PostRow v-for="p in posts" :key="p.id" :pkg="store.pkg" :post="p" :alert="alertIds.includes(p.id)" />
        <p v-if="!store.pkg.posts.length" class="note">Er zijn nog geen posten ingevoerd.</p>
        <p v-else-if="!posts.length" class="note">Geen post gevonden.</p>
      </div>
    </template>
    <p v-else class="note">Geen bereik, en de gegevens van het evenement staan nog niet op deze telefoon. Probeer het opnieuw met internet.</p>
  </main>
</template>

<style scoped>
.map { position: relative; height: clamp(240px, 40dvh, 480px); }
.banner {
  position: absolute; left: 12px; top: 12px; right: 12px; z-index: 2; display: flex; align-items: center; gap: 8px; width: fit-content; max-width: calc(100% - 24px);
  padding: 8px 12px; border-radius: 12px; background: var(--danger); color: #FFFFFF; font-size: 13px; font-weight: 600; text-decoration: none;
}
.find { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 8px; margin: 12px 0; }
.search { position: relative; display: block; color: var(--muted); }
.search svg { position: absolute; left: 12px; top: 13px; }
.search .input { padding-left: 38px; }
.type { width: auto; max-width: 130px; padding: 0 8px 0 12px; appearance: auto; font-size: 14px; font-weight: 600; }
</style>
