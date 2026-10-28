<script setup lang="ts">
// 3.5 · Postdetail: waar is de post, hoe kom je er, wie bel je, en waar is de dichtstbijzijnde EHBO.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { formatKm, formatPhone, telHref } from '@ehbo/shared';
import EventMap from '../components/EventMap.vue';
import Icon from '../components/Icon.vue';
import PostBadge from '../components/PostBadge.vue';
import { navigationUrl } from '../navigate.ts';
import { kmLabel, nearestUnit, primaryContact, unitsAt } from '../posts.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const session = useSessionStore();
const router = useRouter();
const copied = ref(false);

const post = computed(() => store.postById.get(Number(props.id)) ?? null);
const type = computed(() => (post.value ? store.typeById.get(post.value.typeId) : undefined));
const contact = computed(() => (post.value ? primaryContact(post.value) : null));
const here = computed(() => (store.pkg && post.value ? unitsAt(store.pkg, post.value.id) : []));
const nearest = computed(() => (store.pkg && post.value && !here.value.length ? nearestUnit(store.pkg, post.value) : null));
const ROLE = { verantwoordelijke: 'verantwoordelijke', lid: 'lid', reserve: 'reserve' } as const;

const subtitle = computed(() => {
  const p = post.value;
  if (!p) return '';
  const open = p.timeFrom && p.timeTo ? `open ${p.timeFrom} – ${p.timeTo}` : p.timeFrom ? `open vanaf ${p.timeFrom}` : null;
  return [kmLabel(p.km), open].filter(Boolean).join(' · ');
});

const back = () => (router.options.history.state.back ? router.back() : router.push({ name: 'kaart' }));

async function copyGps() {
  if (!post.value) return;
  await navigator.clipboard.writeText(`${post.value.lat}, ${post.value.lng}`);
  copied.value = true;
  setTimeout(() => (copied.value = false), 2000);
}
</script>

<template>
  <main class="screen tight">
    <header class="top">
      <button class="icon-btn" aria-label="Terug" @click="back"><Icon name="back" /></button>
      <span class="top-title">Post</span>
      <RouterLink v-if="session.me?.isAdmin && post" :to="{ name: 'beheer-post', params: { id: post.id } }" class="edit">Bewerken</RouterLink>
    </header>

    <p v-if="!post || !store.pkg" class="note warn">Deze post bestaat niet (meer).</p>
    <template v-else>
      <div class="title">
        <PostBadge :type="type" :size="56" />
        <div class="stack">
          <span class="type" :style="{ color: type?.color }">{{ type?.name }}</span>
          <h1>{{ post.name }}</h1>
          <span v-if="subtitle" class="small">{{ subtitle }}</span>
        </div>
      </div>

      <div v-if="post.lat !== null" class="map">
        <EventMap :pkg="store.pkg" :focus-post-id="post.id" />
      </div>

      <div class="card stack facts">
        <div v-if="post.lat !== null" class="fact gps">
          <span class="stack">
            <span class="label">GPS</span>
            <span class="mono coords">{{ post.lat.toFixed(5) }}, {{ post.lng?.toFixed(5) }}</span>
          </span>
          <button class="copy" @click="copyGps">{{ copied ? 'Gekopieerd' : 'Kopieer' }}</button>
        </div>
        <div v-else class="fact"><span class="label">GPS</span><span>Nog geen locatie vastgelegd</span></div>
        <div v-if="post.address" class="fact"><span class="label">Adres</span><span>{{ post.address }}</span></div>
        <div v-if="post.accessRoute" class="fact"><span class="label">Aanrijroute hulpverlening</span><span>{{ post.accessRoute }}</span></div>
      </div>

      <div v-if="post.contacts?.length" class="list">
        <div v-for="c in post.contacts" :key="c.phone" class="list-row">
          <span class="main">
            <span class="title-line">{{ c.name || 'Naam onbekend' }} · <span class="role">{{ ROLE[c.role] }}</span></span>
            <span class="sub mono">{{ formatPhone(c.phone) }}</span>
          </span>
          <a :href="telHref(c.phone)" class="round" :aria-label="`Bel ${c.name || 'contactpersoon'}`"><Icon name="phone" :size="20" /></a>
        </div>
      </div>

      <p v-if="here.length" class="note ok nearest">
        <PostBadge :type="store.pkg.postTypes.find((t) => t.key === 'ehbo')" :size="22" />
        <span>EHBO hier: <strong>{{ here.map((u) => u.name).join(', ') }}</strong></span>
      </p>
      <p v-else-if="nearest" class="note ok nearest">
        <PostBadge :type="store.pkg.postTypes.find((t) => t.key === 'ehbo')" :size="22" />
        <span>Dichtstbij: <strong>{{ nearest.post.name }} · {{ nearest.unit.name }}</strong> · {{ formatKm(nearest.km) }} km</span>
      </p>

      <div class="grow" />
      <div class="actions">
        <a v-if="contact" :href="telHref(contact.phone)" class="btn big"><Icon name="phone" :size="20" />Bel post</a>
        <a
          v-if="post.lat !== null && post.lng !== null" :href="navigationUrl(post.lat, post.lng, post.name)"
          class="btn primary"
        ><Icon name="navigate" :size="20" />Navigeer</a>
      </div>
    </template>
  </main>
</template>

<style scoped>
.top { display: flex; align-items: center; gap: 4px; padding: max(14px, env(safe-area-inset-top)) 0 6px; margin-left: -12px; }
.top-title { flex-grow: 1; font-size: 16px; font-weight: 700; }
.edit { font-size: 14px; font-weight: 600; padding: 12px 0; }
.title { display: flex; align-items: center; gap: 14px; margin: 10px 0 16px; }
.type { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
h1 { font-size: 22px; font-weight: 700; line-height: 1.2; }
.map { height: 140px; margin-bottom: 12px; }
.facts { gap: 0; margin-bottom: 12px; }
.fact { display: flex; flex-direction: column; gap: 2px; padding: 10px 0; font-size: 14px; border-top: 1px solid var(--divider); }
.fact:first-child { border-top: none; padding-top: 0; }
.fact.gps { flex-direction: row; align-items: center; justify-content: space-between; }
.label { font-size: 12px; color: var(--muted); }
.coords { font-size: 16px; }
.copy { height: 36px; padding: 0 12px; border-radius: 10px; border: 1px solid var(--line); background: #FFFFFF; font: 600 13px var(--sans); color: var(--ink); cursor: pointer; }
.role { font-weight: 400; }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--soft); color: var(--ink); }
.nearest { margin-top: 12px; align-items: center; }
.actions { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; padding-top: 18px; }
/* Twee knoppen naast elkaar zijn altijd even hoog. */
.btn.big { height: 56px; border-radius: 16px; font-size: 16px; }
</style>
