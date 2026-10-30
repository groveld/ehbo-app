<script setup lang="ts">
// 3.5 · Postdetail: waar is de post, hoe kom je er, wie bel je, en waar is de dichtstbijzijnde EHBO.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { formatKm, formatPhone, telHref } from '@ehbo/shared';
import EventMap from '../components/EventMap.vue';
import Icon from '../components/Icon.vue';
import KmPoints from '../components/KmPoints.vue';
import NotOnPhone from '../components/NotOnPhone.vue';
import PostBadge from '../components/PostBadge.vue';
import { navigationUrl } from '../navigate.ts';
import { useSave } from '../composables/useSave.ts';
import { kmLabel, mobileUnits, nearestUnit, primaryContact, unitsAt } from '../posts.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const session = useSessionStore();
const router = useRouter();
const toggle = useSave();

const post = computed(() => store.postById.get(Number(props.id)) ?? null);
const type = computed(() => (post.value ? store.typeById.get(post.value.typeId) : undefined));
const contact = computed(() => (post.value ? primaryContact(post.value) : null));
const here = computed(() => (store.pkg && post.value ? unitsAt(store.pkg, post.value.id) : []));
const nearest = computed(() => (store.pkg && post.value && !here.value.length ? nearestUnit(store.pkg, post.value) : null));
const isOpen = computed(() => (post.value ? live.postOpen(post.value.id, post.value.isOpen) : false));
const mobile = computed(() => mobileUnits(store.pkg, live.state?.units ?? [], live.serverNow));
/** Zoals op de kaart van het overzicht: open oproepen rood, dichte posten grijs. */
const alertIds = computed(() => [...new Set(live.openIncidents.map((i) => i.postId))]);
/** Zoals de server: de postverantwoordelijke van deze post, of een beheerder. */
const canToggle = computed(() => session.me?.isAdmin
  || session.me?.assignments.some((a) => a.kind === 'post' && a.postId === post.value?.id && a.role === 'verantwoordelijke'));

const subtitle = computed(() => {
  const p = post.value;
  if (!p) return '';
  const open = p.timeFrom && p.timeTo ? `open ${p.timeFrom} – ${p.timeTo}` : p.timeFrom ? `open vanaf ${p.timeFrom}` : null;
  return [kmLabel(p), open].filter(Boolean).join(' · ');
});

// Eén stap omhoog: de kaart (navigation.ts).
const back = () => router.back();

/** Wat je doorgeeft als iemand vraagt waar de post is: het adres als dat is ingevuld, anders de GPS-positie. */
const location = computed(() => {
  const p = post.value;
  if (p?.address) return p.address;
  return p && p.lat !== null && p.lng !== null ? `${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}` : null;
});

/** Welke EHBO-eenheid hier hoort: een vaste eenheid op haar eigen EHBO-post, of een mobiele eenheid met hier haar standplaats. */
const hereText = (u: { name: string; kind: string }) => (u.kind === 'vast' ? `EHBO ${u.name} staat op deze post` : `Standplaats van EHBO ${u.name} (mobiel)`);
</script>

<template>
  <main class="screen tight">
    <header class="top">
      <button class="icon-btn" aria-label="Terug" @click="back"><Icon name="back" /></button>
      <span class="top-title">Post</span>
      <RouterLink v-if="session.me?.isAdmin && post" :to="{ name: 'beheer-post', params: { id: post.id } }" class="edit">Bewerken</RouterLink>
    </header>

    <NotOnPhone v-if="!post || !store.pkg">Deze post bestaat niet (meer).</NotOnPhone>
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
        <!-- Net als op het overzicht: tik op een andere post om die te openen. Die vervangt deze pagina, zodat Terug in één stap teruggaat naar waar je vandaan kwam. -->
        <EventMap
          :pkg="store.pkg" :focus-post-id="post.id" :alert-post-ids="alertIds"
          :ambulances="mobile.ambulances" :away-post-ids="mobile.awayPostIds"
          @select="(id) => id !== post!.id && router.replace({ name: 'post', params: { id } })"
        />
      </div>

      <div class="card stack post-facts">
        <div v-if="location" class="fact location">
          <span class="stack">
            <span class="label">Locatie</span>
            <span :class="post.address ? 'address' : 'mono coords'">{{ location }}</span>
          </span>
        </div>
        <div v-else class="fact"><span class="label">Locatie</span><span>Nog geen locatie vastgelegd</span></div>
        <div v-if="post.passages.length" class="fact stack gap-6"><span class="label">Km-punten</span><KmPoints :passages="post.passages" :runs="store.pkg.runs" /></div>
        <div v-if="post.accessRoute" class="fact"><span class="label">Aanrijroute hulpverlening</span><span>{{ post.accessRoute }}</span></div>
      </div>

      <!-- Open of dicht, live. Een beheerder kan elke post open en dicht zetten, voor wie minder technisch is. -->
      <div class="card open-row">
        <span class="dot" :class="{ on: isOpen }" />
        <span class="grow"><strong>{{ isOpen ? 'Post is open' : 'Post is dicht' }}</strong></span>
        <button
          v-if="canToggle" class="switch" role="switch" :aria-checked="isOpen" aria-label="Post open"
          :disabled="toggle.busy.value" @click="toggle.run(() => live.setPostOpen(post!.id, !isOpen))"
        />
      </div>
      <p v-if="toggle.error.value" class="error-text" role="alert">{{ toggle.error.value }}</p>

      <div v-if="post.contacts?.length" class="list">
        <div v-for="c in post.contacts" :key="c.phone" class="list-row">
          <span class="main">
            <span class="title-line">{{ c.name || 'Naam onbekend' }} · <span class="role">{{ c.role }}</span></span>
            <span class="sub mono">{{ formatPhone(c.phone) }}</span>
          </span>
          <a :href="telHref(c.phone)" class="round" :aria-label="`Bel ${c.name || 'contactpersoon'}`"><Icon name="phone" :size="20" /></a>
        </div>
      </div>

      <p v-if="here.length" class="note ok nearest">
        <PostBadge :type="store.pkg.postTypes.find((t) => t.key === 'ehbo')" :size="22" />
        <strong>{{ here.map(hereText).join(' · ') }}</strong>
      </p>
      <p v-else-if="nearest" class="note ok nearest">
        <PostBadge :type="store.pkg.postTypes.find((t) => t.key === 'ehbo')" :size="22" />
        <span>Dichtstbijzijnde EHBO: <strong>{{ nearest.unit.name }}</strong> bij {{ nearest.post.name }} · {{ formatKm(nearest.km) }} km</span>
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
.open-row { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
.open-row .dot { width: 10px; height: 10px; border-radius: 50%; background: #A8A59C; }
.open-row .dot.on { background: var(--ok); }
.top { display: flex; align-items: center; gap: 4px; padding: max(14px, env(safe-area-inset-top)) 0 6px; margin-left: -12px; }
.top-title { flex-grow: 1; font-size: 16px; font-weight: 700; }
.edit { font-size: 14px; font-weight: 600; padding: 12px 0; }
.title { display: flex; align-items: center; gap: 14px; margin: 10px 0 16px; }
.type { font-size: 12px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
h1 { font-size: 22px; font-weight: 700; line-height: 1.2; }
.map { height: clamp(200px, 30dvh, 360px); margin-bottom: 12px; }
.post-facts { gap: 0; margin-bottom: 12px; }
.fact { border-radius: 0; padding: 10px 0; font-size: 14px; border-top: 1px solid var(--divider); }
.fact:first-child { border-top: none; padding-top: 0; }
.label { font-size: 12px; color: var(--muted); }
.coords { font-size: 16px; white-space: nowrap; }
.address { font-size: 16px; font-weight: 600; }
.role { font-weight: 400; }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--soft); color: var(--ink); }
.nearest { margin-top: 12px; align-items: center; }
.actions { display: grid; grid-auto-flow: column; grid-auto-columns: 1fr; gap: 10px; padding-top: 18px; }
/* Twee knoppen naast elkaar zijn altijd even hoog. */
.btn.big { height: 56px; font-size: 16px; }
</style>
