<script setup lang="ts">
// Alle posten, op km-punt, met zoeken op naam of km.
import { computed, ref } from 'vue';
import Icon from '../../components/Icon.vue';
import OverviewHeader from '../../components/OverviewHeader.vue';
import PostRow from '../../components/PostRow.vue';
import { usePackageStore } from '../../stores/package.ts';

const store = usePackageStore();
const query = ref('');

const posts = computed(() => {
  const q = query.value.trim().toLowerCase().replace(',', '.');
  const all = store.pkg?.posts ?? [];
  if (!q) return all;
  return all.filter((p) => p.name.toLowerCase().includes(q) || (p.km !== null && String(p.km).startsWith(q.replace(/^km\s*/, ''))));
});
</script>

<template>
  <main class="screen tight">
    <OverviewHeader title="Posten" />
    <template v-if="store.pkg">
      <label class="search">
        <Icon name="search" :size="18" />
        <input v-model="query" class="input" type="search" placeholder="Zoek op naam of km-punt" aria-label="Zoek een post">
      </label>
      <div class="stack gap-10">
        <PostRow v-for="p in posts" :key="p.id" :pkg="store.pkg" :post="p" />
        <p v-if="!posts.length" class="note">{{ query ? 'Geen post gevonden.' : 'Er zijn nog geen posten ingevoerd.' }}</p>
      </div>
    </template>
  </main>
</template>

<style scoped>
.search { position: relative; display: block; margin-bottom: 12px; color: var(--muted); }
.search svg { position: absolute; left: 12px; top: 13px; }
.search .input { padding-left: 38px; }
</style>
