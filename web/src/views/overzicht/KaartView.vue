<script setup lang="ts">
// 3.4 · Overzicht & kaart: alle posten op de kaart, filter per soort, en de lijst met bel- en navigeerknoppen.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import EventMap from '../../components/EventMap.vue';
import Icon from '../../components/Icon.vue';
import OverviewHeader from '../../components/OverviewHeader.vue';
import PostRow from '../../components/PostRow.vue';
import { useLiveStore } from '../../stores/live.ts';
import { usePackageStore } from '../../stores/package.ts';

const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();
const filter = ref<number | null>(null);

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
const posts = computed(() => (store.pkg?.posts.filter((p) => filter.value === null || p.typeId === filter.value) ?? [])
  .slice().sort((a, b) => Number(alertIds.value.includes(b.id)) - Number(alertIds.value.includes(a.id))));
const banner = computed(() => {
  const open = live.openIncidents;
  if (!open.length) return null;
  const names = [...new Set(open.map((i) => store.postById.get(i.postId)?.name.split(' · ')[0]))].filter(Boolean);
  return `${open.length} open ${open.length === 1 ? 'oproep' : 'oproepen'} · ${names.join(', ')}`;
});
</script>

<template>
  <main class="screen tight">
    <OverviewHeader title="Kaart" />
    <template v-if="store.pkg">
      <div class="map">
        <EventMap
          :pkg="store.pkg" :posts="posts" :alert-post-ids="alertIds" :closed-post-ids="closedIds"
          @select="(id) => router.push({ name: 'post', params: { id } })"
        />
        <RouterLink v-if="banner" :to="{ name: 'verzoeken' }" class="banner"><Icon name="bell" :size="16" />{{ banner }}</RouterLink>
      </div>

      <div class="chips" role="group" aria-label="Filter op soort post">
        <button class="chip-btn" :aria-pressed="filter === null" @click="filter = null">Alle {{ store.pkg.posts.length }}</button>
        <button v-for="c in chips" :key="c.id" class="chip-btn" :aria-pressed="filter === c.id" @click="filter = filter === c.id ? null : c.id">
          {{ c.label }} {{ c.count }}
        </button>
      </div>

      <div class="stack gap-10">
        <PostRow v-for="p in posts" :key="p.id" :pkg="store.pkg" :post="p" :alert="alertIds.includes(p.id)" />
        <p v-if="!store.pkg.posts.length" class="note">Er zijn nog geen posten ingevoerd.</p>
      </div>
    </template>
    <p v-else class="note">Geen bereik, en de gegevens van het evenement staan nog niet op deze telefoon. Probeer het opnieuw met internet.</p>
  </main>
</template>

<style scoped>
.map { position: relative; height: 300px; }
.banner {
  position: absolute; left: 12px; top: 12px; right: 12px; z-index: 2; display: flex; align-items: center; gap: 8px; width: fit-content; max-width: calc(100% - 24px);
  padding: 8px 12px; border-radius: 12px; background: var(--danger); color: #FFFFFF; font-size: 13px; font-weight: 600; text-decoration: none;
}
.chips { display: flex; gap: 8px; overflow-x: auto; padding: 14px 16px; margin: 0 -16px; scrollbar-width: none; }
.chips::-webkit-scrollbar { display: none; }
.chip-btn {
  flex-shrink: 0; height: 40px; padding: 0 16px; border-radius: 999px; border: 1px solid var(--line); background: var(--card);
  font: 600 14px var(--sans); color: var(--ink); cursor: pointer; white-space: nowrap;
}
.chip-btn[aria-pressed="true"] { background: var(--primary); border-color: var(--primary); color: #FFFFFF; }
</style>
