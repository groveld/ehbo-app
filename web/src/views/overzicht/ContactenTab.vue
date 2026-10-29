<script setup lang="ts">
// Iedereen bereikbaar: noodnummers bovenaan, dan de organisatie (kernteam), EHBO en de posten.
import { computed } from 'vue';
import { formatPhone, telHref } from '@ehbo/shared';
import Icon from '../../components/Icon.vue';
import OverviewHeader from '../../components/OverviewHeader.vue';
import { usePackageStore } from '../../stores/package.ts';

const store = usePackageStore();
const postsWithContacts = computed(() => store.pkg?.posts.filter((p) => p.contacts?.length) ?? []);
const ROLE = { verantwoordelijke: 'verantwoordelijke', lid: 'lid', reserve: 'reserve' } as const;
</script>

<template>
  <main class="screen tight">
    <OverviewHeader title="Contacten" />
    <div v-if="store.pkg" class="stack gap-14">
      <section class="stack gap-8">
        <h2 class="section-title">Noodnummers</h2>
        <div class="list">
          <div class="list-row">
            <span class="main"><span class="title-line">112</span><span class="sub">Bij levensgevaar altijd eerst</span></span>
            <a href="tel:112" class="round urgent" aria-label="Bel 112"><Icon name="phone" :size="20" /></a>
          </div>
          <div v-for="n in store.pkg.emergencyNumbers" :key="n.label" class="list-row">
            <span class="main"><span class="title-line">{{ n.label }}</span><span class="sub mono">{{ formatPhone(n.number) }}</span></span>
            <a :href="telHref(n.number)" class="round" :aria-label="`Bel ${n.label}`"><Icon name="phone" :size="20" /></a>
          </div>
        </div>
      </section>

      <section v-if="store.pkg.coreTeam.length" class="stack gap-8">
        <h2 class="section-title">Organisatie</h2>
        <div class="list">
          <div v-for="c in store.pkg.coreTeam" :key="c.function" class="list-row">
            <span class="main">
              <span class="title-line">{{ c.function }}</span>
              <span class="sub">{{ c.name || formatPhone(c.phone) }}</span>
            </span>
            <a :href="telHref(c.phone)" class="round" :aria-label="`Bel ${c.function}`"><Icon name="phone" :size="20" /></a>
          </div>
        </div>
      </section>

      <section v-if="store.pkg.units.length" class="stack gap-8">
        <h2 class="section-title">EHBO</h2>
        <div class="list">
          <template v-for="u in store.pkg.units" :key="u.id">
            <div v-for="m in u.members" :key="`${u.id}-${m.phone}`" class="list-row">
              <span class="main">
                <span class="title-line">{{ m.name || formatPhone(m.phone) }}</span>
                <span class="sub">EHBO {{ u.name }}<template v-if="u.hasAed"> · AED</template></span>
              </span>
              <a :href="telHref(m.phone)" class="round" :aria-label="`Bel ${m.name || u.name}`"><Icon name="phone" :size="20" /></a>
            </div>
          </template>
        </div>
      </section>

      <section v-if="postsWithContacts.length" class="stack gap-8">
        <h2 class="section-title">Posten</h2>
        <div class="list">
          <template v-for="p in postsWithContacts" :key="p.id">
            <div v-for="c in p.contacts" :key="`${p.id}-${c.phone}`" class="list-row">
              <span class="main">
                <span class="title-line">{{ c.name || formatPhone(c.phone) }}</span>
                <span class="sub">{{ p.name }} · {{ ROLE[c.role] }}</span>
              </span>
              <a :href="telHref(c.phone)" class="round" :aria-label="`Bel ${c.name || p.name}`"><Icon name="phone" :size="20" /></a>
            </div>
          </template>
        </div>
      </section>
    </div>
  </main>
</template>

<style scoped>
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--soft); color: var(--ink); }
.round.urgent { background: var(--danger); color: #FFFFFF; }
</style>
