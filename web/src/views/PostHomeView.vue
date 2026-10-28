<script setup lang="ts">
// 3.1 · Post openen en 3.2 · Post open: wat heb je nodig? Het startscherm van een post.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { POST_CONTACT_ROLE_LABEL, formatKm, formatPhone, telHref } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import Sos112Bar from '../components/Sos112Bar.vue';
import { useSave } from '../composables/useSave.ts';
import { clock, incidentSummary } from '../incidents.ts';
import { coordinatorOf, kmLabel, nearestUnit } from '../posts.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const session = useSessionStore();
const router = useRouter();
const { busy, error, run } = useSave();

const post = computed(() => store.postById.get(Number(props.id)) ?? null);
const open = computed(() => (post.value ? live.postOpen(post.value.id, post.value.isOpen) : false));
const myRole = computed(() => session.me?.assignments.find((a) => a.kind === 'post' && a.postId === post.value?.id));
const canOpen = computed(() => myRole.value?.role === 'verantwoordelijke' || session.me?.isAdmin);
const coordinator = computed(() => coordinatorOf(store.pkg));
const nearest = computed(() => (store.pkg && post.value ? nearestUnit(store.pkg, post.value) : null));
const openIncidents = computed(() => live.openIncidents.filter((i) => i.postId === post.value?.id));

/** Eerst wie je bent, dan de post; "gepland" zolang de post dicht is, anders sinds wanneer hij open is. */
const eyebrow = computed(() => [myRole.value?.title, session.me?.name].filter(Boolean).join(' · '));
const planned = computed(() => {
  const p = post.value;
  if (!p) return '';
  const times = p.timeFrom && p.timeTo ? `gepland open ${p.timeFrom} – ${p.timeTo}` : null;
  return [kmLabel(p.km), times].filter(Boolean).join(' · ');
});

// Water, verkeer en vrijwilliger gaan in fase 4 naar de wachtrij; tot dan bel je de coördinator, net als bij "Anders".
const TILES = [
  { key: 'water', label: 'Water', sub: 'Bijvullen', bg: '#E4EEF7', line: '#B8D0E6', icon: '#1F6FB2' },
  { key: 'verkeer', label: 'Verkeer', sub: 'Hulp bij regelen', bg: '#FBE6D2', line: '#EDC7A2', icon: '#D9781C' },
  { key: 'vrijwilliger', label: 'Vrijwilliger', sub: 'Aflossing, uitval', bg: '#EDE4F7', line: '#D2C1EA', icon: '#7A4BB7' },
] as const;

async function setOpen(value: boolean) {
  if (!post.value) return;
  if (!value && !confirm(`${post.value.name} sluiten? Dan kan de post geen verzoeken meer doen.`)) return;
  await run(() => live.setPostOpen(post.value!.id, value));
}
</script>

<template>
  <main class="screen tight">
    <p v-if="!post || !store.pkg" class="note warn top-gap">Deze post staat niet (meer) in de gegevens van het evenement.</p>
    <template v-else>
      <header class="head">
        <div class="stack gap-4 grow">
          <span class="eyebrow">{{ eyebrow }}</span>
          <h1>{{ post.name }}</h1>
          <span v-if="open" class="small">{{ kmLabel(post.km) }}<template v-if="post.km !== null"> · </template><strong class="open">post open</strong></span>
          <span v-else class="small">{{ planned }}</span>
        </div>
        <button v-if="open && canOpen" class="close-post" :disabled="busy" @click="setOpen(false)"><Icon name="close" :size="14" />Post sluiten</button>
        <RouterLink :to="{ name: 'menu' }" class="icon-btn" aria-label="Menu"><Icon name="menu" /></RouterLink>
      </header>

      <p v-if="error" class="error-text" role="alert">{{ error }}</p>

      <!-- 3.1 · Post is dicht -->
      <template v-if="!open">
        <div class="card closed">
          <span class="closed-chip"><span class="dot" />POST IS DICHT</span>
          <p v-if="canOpen" class="lead center">Ben je op je plek en is alles klaar? Zet de post open. Dan ziet de evenementcoördinator dat je er bent en werkt de hulpknop.</p>
          <p v-else class="lead center">De postverantwoordelijke zet de post open. Daarna werkt de hulpknop ook voor jou.</p>
          <button v-if="canOpen" class="btn go" :disabled="busy" @click="setOpen(true)">Post openen</button>
        </div>

        <span class="section-label people-label">Op deze post</span>
        <div class="list">
          <div v-for="c in post.contacts ?? []" :key="c.phone" class="list-row">
            <span class="main">
              <span class="title-line">{{ c.name || formatPhone(c.phone) }}<template v-if="c.phone === session.me?.phone"> (jij)</template></span>
              <span class="sub">{{ POST_CONTACT_ROLE_LABEL[c.role] }} · {{ formatPhone(c.phone) }}</span>
            </span>
            <a :href="telHref(c.phone)" class="round" :aria-label="`Bel ${c.name}`"><Icon name="phone" :size="17" /></a>
          </div>
        </div>
        <p v-if="nearest" class="note ok nearest">
          <Icon name="cross" :size="14" /><span>Dichtstbij: <strong>{{ nearest.post.name }}</strong> · {{ formatKm(nearest.km) }} km</span>
        </p>
      </template>

      <!-- 3.2 · Post open: wat heb je nodig? -->
      <template v-else>
        <span class="ask">Wat heb je nodig?</span>
        <div class="tiles">
          <RouterLink :to="{ name: 'ehbo-verzoek', params: { id: post.id } }" class="tile ehbo">
            <span class="tile-icon" style="background: var(--danger)"><Icon name="cross" :size="22" /></span>
            <span class="tile-text"><span class="tile-label">EHBO</span><span class="tile-sub">Eerste hulp nodig</span></span>
          </RouterLink>
          <a
            v-for="t in TILES" :key="t.key" :href="coordinator ? telHref(coordinator.phone) : undefined" class="tile"
            :style="{ background: t.bg, borderColor: t.line }" :aria-label="`${t.label}: bel de evenementcoördinator`"
          >
            <span class="tile-icon" :style="{ background: t.icon }"><Icon name="phone" :size="20" /></span>
            <span class="tile-text"><span class="tile-label">{{ t.label }}</span><span class="tile-sub">{{ t.sub }} · bel coördinator</span></span>
          </a>
          <a :href="coordinator ? telHref(coordinator.phone) : undefined" class="tile other">
            <span class="tile-icon" style="background: var(--primary)"><Icon name="phone" :size="20" /></span>
            <span class="tile-text"><span class="tile-label">Anders</span><span class="tile-sub">Bel de evenementcoördinator</span></span>
          </a>
        </div>

        <div class="card requests">
          <template v-if="openIncidents.length">
            <RouterLink v-for="i in openIncidents" :key="i.id" :to="{ name: 'melding', params: { id: i.id } }" class="request">
              <span class="mono at">{{ clock(i.reportedAt) }}</span>
              <span class="grow">EHBO · {{ incidentSummary(i) }}</span>
              <span class="state">{{ i.status === 'verstuurd' ? 'zoeken' : i.status === 'geaccepteerd' ? 'onderweg' : 'ter plaatse' }}</span>
              <Icon name="forward" :size="16" />
            </RouterLink>
          </template>
          <div v-else class="request"><span class="grow muted">Open verzoeken van deze post</span><strong>geen</strong></div>
        </div>
      </template>

      <div class="grow" />
      <Sos112Bar class="sos-gap" :text="open ? 'Levensgevaar? Bel eerst 112' : 'Levensgevaar? Bel 112'" />
    </template>
  </main>
</template>

<style scoped>
.top-gap { margin-top: 24px; }
.head { display: flex; align-items: flex-start; gap: 8px; padding: max(20px, env(safe-area-inset-top)) 0 8px 4px; }
.gap-4 { gap: 4px; }
h1 { font-size: 24px; font-weight: 700; line-height: 1.2; }
.open { color: var(--ok-text); }
.close-post {
  flex-shrink: 0; height: 36px; padding: 0 12px; border-radius: 999px; border: 1px solid #EDB9B4; background: #FDF1F0; color: #A61F18;
  font: 600 13px var(--sans); display: flex; align-items: center; gap: 6px; cursor: pointer; margin-top: 4px;
}
.icon-btn { margin: -2px -10px 0 -6px; }
.closed { display: flex; flex-direction: column; align-items: center; gap: 14px; margin-top: 14px; padding: 18px; border-radius: 20px; }
.closed-chip { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; color: var(--muted); background: var(--soft); padding: 6px 12px; border-radius: 999px; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: #8A8780; }
.center { text-align: center; }
.people-label { margin: 14px 4px 6px; }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--soft); color: var(--ink); }
.nearest { margin-top: 10px; align-items: center; }
.ask { font-size: 16px; font-weight: 700; padding: 14px 4px 10px; }
/* Bewust grote tegels: de enige uitzondering op de knopmaten. */
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.tile {
  height: 128px; border-radius: 18px; border: 1px solid; color: var(--ink); text-decoration: none;
  display: flex; flex-direction: column; justify-content: space-between; padding: 16px; -webkit-touch-callout: none;
}
.tile.ehbo { background: #FBE3E1; border: 2px solid var(--danger); }
.tile.other { grid-column: 1 / -1; height: 72px; flex-direction: row; align-items: center; justify-content: flex-start; gap: 14px; background: var(--card); border-color: #D4D1C7; }
.tile-icon { width: 44px; height: 44px; flex-shrink: 0; border-radius: 12px; display: flex; align-items: center; justify-content: center; color: #FFFFFF; }
.tile-text { display: flex; flex-direction: column; gap: 2px; }
.tile-label { font-size: 18px; font-weight: 700; }
.tile.other .tile-label { font-size: 17px; }
.tile-sub { font-size: 13px; color: var(--ink-2); }
.requests { margin-top: 12px; padding: 4px 14px; border-radius: 14px; }
.request { display: flex; align-items: center; gap: 10px; min-height: 44px; font-size: 13px; color: var(--ink); text-decoration: none; }
.request + .request { border-top: 1px solid var(--divider); }
.at { color: var(--muted); }
.state { font-weight: 700; color: var(--danger); }
.muted { color: var(--ink-2); }
.sos-gap { margin: 18px 0 0; }
</style>
