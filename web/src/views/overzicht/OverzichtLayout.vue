<script setup lang="ts">
// 3.4 · Overzicht voor medewerkers: kaart, posten, verzoeken en contacten, met een vaste balk onderaan.
import { onMounted } from 'vue';
import Icon from '../../components/Icon.vue';
import { usePackageStore } from '../../stores/package.ts';

const pkg = usePackageStore();
onMounted(() => pkg.refresh());

const TABS = [
  { name: 'kaart', label: 'Kaart', icon: 'map' },
  { name: 'posten', label: 'Posten', icon: 'list' },
  { name: 'verzoeken', label: 'Verzoeken', icon: 'bell' },
  { name: 'contacten', label: 'Contacten', icon: 'people' },
] as const;
</script>

<template>
  <div class="overview">
    <RouterView />
    <nav class="tabbar" aria-label="Overzicht">
      <RouterLink v-for="tab in TABS" :key="tab.name" :to="{ name: tab.name }" class="tab">
        <Icon :name="tab.icon" :size="22" />
        <span>{{ tab.label }}</span>
      </RouterLink>
    </nav>
  </div>
</template>

<style scoped>
.overview { min-height: 100dvh; padding-bottom: calc(72px + env(safe-area-inset-bottom)); }
.tabbar {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 10; display: grid; grid-template-columns: repeat(4, 1fr);
  padding: 8px 8px max(8px, env(safe-area-inset-bottom)); background: var(--card); border-top: 1px solid var(--divider);
}
.tab { display: flex; flex-direction: column; align-items: center; gap: 2px; min-height: 52px; justify-content: center; font-size: 12px; color: var(--muted); text-decoration: none; }
.tab.router-link-active { color: var(--ink); font-weight: 700; }
</style>
