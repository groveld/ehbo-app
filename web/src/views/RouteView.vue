<script setup lang="ts">
// A page per run: details, a map with only this route, the GPX to download, and the posts along it in order.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { formatKm } from '@ehbo/shared';
import CallEhbo from '../components/CallEhbo.vue';
import EventMap from '../components/EventMap.vue';
import Icon from '../components/Icon.vue';
import NotOnPhone from '../components/NotOnPhone.vue';
import PostBadge from '../components/PostBadge.vue';
import { useFavorites } from '../composables/useFavorites.ts';
import { formatDate } from '../format.ts';
import { routeStops } from '../posts.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const session = useSessionStore();
const router = useRouter();
const { favorites, toggleFavorite } = useFavorites();

const run = computed(() => store.pkg?.runs.find((r) => r.id === Number(props.id)) ?? null);
const stops = computed(() => (store.pkg && run.value ? routeStops(store.pkg, run.value.id) : []));
const posts = computed(() => [...new Set(stops.value.map((s) => s.post))]);
const date = computed(() => formatDate(run.value?.date ?? store.pkg?.event.startDate));
const isFavorite = computed(() => (run.value ? favorites.value.includes(run.value.id) : false));
</script>

<template>
  <main class="screen tight">
    <header class="page-header">
      <button class="icon-btn" aria-label="Terug" @click="router.back()"><Icon name="back" /></button>
      <div>
        <span v-if="date" class="eyebrow">{{ date }}</span>
        <h1>{{ run?.name ?? 'Route' }}</h1>
      </div>
      <button
        v-if="run" class="icon-btn star-btn" :class="{ favorite: isFavorite }" :aria-label="`Favoriet: ${run.name}`" :aria-pressed="isFavorite"
        @click="toggleFavorite(run.id)"
      ><Icon name="star" :size="22" class="star" /></button>
    </header>

    <NotOnPhone v-if="!run || !store.pkg">Deze route staat niet (meer) in de gegevens van het evenement.</NotOnPhone>
    <div v-else class="stack gap-14">
      <div class="facts">
        <div class="fact"><span class="label">Afstand</span><span class="value">{{ run.distanceKm !== null ? `${formatKm(run.distanceKm)} km` : '–' }}</span></div>
        <div class="fact"><span class="label">Start</span><span class="value mono">{{ run.startTime ?? '–' }}</span></div>
        <div class="fact"><span class="label">Soort</span><span class="kind">{{ run.discipline ?? '–' }}</span></div>
      </div>

      <template v-if="run.line">
        <div class="map">
          <EventMap :pkg="store.pkg" :posts="posts" :highlight-run-id="run.id" only-highlighted />
        </div>
        <a :href="`/gpx/${run.id}.gpx`" class="btn" download><Icon name="download" :size="20" />GPX downloaden</a>
      </template>
      <p v-else class="note">Voor deze loop is nog geen route ingevoerd.</p>

      <section v-if="run.line && stops.length" class="stack gap-8">
        <h2 class="section-title">Op deze route</h2>
        <div class="list">
          <div v-for="{ post, km } in stops" :key="`${post.id}-${km}`" class="list-row">
            <span class="mono km">{{ km !== null ? `km ${formatKm(km)}` : '' }}</span>
            <PostBadge :type="store.typeById.get(post.typeId)" :size="28" />
            <span class="post-name">{{ post.name }}</span>
          </div>
        </div>
      </section>
    </div>
    <CallEhbo v-if="!session.me" />
  </main>
</template>

<style scoped>
.page-header { position: relative; padding-right: 44px; }
.star-btn { position: absolute; right: 0; top: 10px; }
.star { color: #9A9CA3; }
.favorite .star { color: #D9A400; fill: #F2C230; }
.fact { min-width: 0; }
.kind { font-size: 13px; font-weight: 600; line-height: 1.25; }
.map { height: clamp(220px, 38dvh, 460px); }
/* The last row can end up under the Bel EHBO button: keep its name clear of it. */
.list-row:last-child { padding-right: 152px; }
.km { width: 56px; flex-shrink: 0; font-size: 13px; color: var(--ink-2); }
.post-name { font-size: 15px; }
</style>
