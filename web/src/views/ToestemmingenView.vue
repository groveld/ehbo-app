<script setup lang="ts">
// 2.7 · Meldingen, locatie en testmelding. Ook later te openen via het menu.
import { computed, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import { isIOS } from '../platform.ts';
import { useLocationStore } from '../stores/location.ts';
import { usePushStore } from '../stores/push.ts';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
const push = usePushStore();
const location = useLocationStore();
const showQuietHelp = ref(false);
const testSent = ref(false);

const who = computed(() => [session.firstName, session.me?.assignments[0]?.title].filter(Boolean).join(', '));

const notifications = computed(() => {
  if (push.subscribed) return { state: 'Aan', tone: 'ok' } as const;
  if (push.permission === 'denied') return { state: 'Geweigerd', tone: 'bad' } as const;
  if (push.permission === 'unsupported') return { state: 'Niet mogelijk', tone: 'bad' } as const;
  return null;
});
const locationState = computed(() => {
  if (location.permission === 'granted') return { state: 'Aan', tone: 'ok' } as const;
  if (location.permission === 'denied') return { state: 'Geweigerd', tone: 'bad' } as const;
  if (location.permission === 'unsupported') return { state: 'Niet mogelijk', tone: 'bad' } as const;
  return null;
});

const deniedHelp = computed(() => isIOS
  ? 'Zet het aan via Instellingen › Meldingen (of Privacy › Locatievoorzieningen) › EHBO-app.'
  : 'Zet het aan via de app-instellingen van je telefoon.');

async function test() {
  await push.testPush(0);
  testSent.value = true;
}

onMounted(() => {
  push.init();
  location.check();
});
</script>

<template>
  <main class="screen tight">
    <div class="stack gap-8 top">
      <span class="eyebrow">Laatste stap<template v-if="who"> · {{ who }}</template></span>
      <h1 class="title">Zet meldingen en locatie aan</h1>
    </div>

    <div class="stack gap-10 rows">
      <div class="card row">
        <span class="badge icon" :class="notifications?.tone === 'bad' ? 'bad' : 'good'"><Icon name="bell" :size="20" /></span>
        <span class="stack text"><span class="name">Meldingen</span><span class="small">Om oproepen te ontvangen</span></span>
        <span v-if="notifications" class="state" :class="notifications.tone">{{ notifications.state }}</span>
        <button v-else class="turn-on" @click="push.enable">Aanzetten</button>
      </div>
      <div class="card row">
        <span class="badge icon" :class="locationState?.tone === 'bad' ? 'bad' : 'good'"><Icon name="pin" :size="20" /></span>
        <span class="stack text"><span class="name">Locatie</span><span class="small">Kaart; mobiele EHBO zolang in dienst</span></span>
        <span v-if="locationState" class="state" :class="locationState.tone">{{ locationState.state }}</span>
        <button v-else class="turn-on" @click="location.request">Aanzetten</button>
      </div>
      <p v-if="notifications?.tone === 'bad' || locationState?.tone === 'bad'" class="note warn">{{ deniedHelp }}</p>
      <div class="card row quiet">
        <span class="badge icon warn"><Icon name="warning" :size="20" /></span>
        <span class="stack text"><span class="name">Stil en Niet storen</span><span class="small">Voor EHBO: uitzetten tijdens het evenement</span></span>
        <button class="turn-on" :aria-expanded="showQuietHelp" @click="showQuietHelp = !showQuietHelp">Hoe?</button>
      </div>
      <div v-if="showQuietHelp" class="note warn stack gap-6">
        <template v-if="isIOS">
          <span>Een webapp kan de stille modus en focus niet doorbreken.</span>
          <span>Zet tijdens het evenement de schakelaar aan de zijkant op <strong>geluid aan</strong>, en zet focus uit via het bedieningspaneel (veeg omlaag vanaf rechtsboven).</span>
        </template>
        <template v-else>
          <span>Een webapp kan Niet storen niet doorbreken.</span>
          <span>Zet tijdens het evenement <strong>Niet storen uit</strong> (veeg omlaag vanaf de bovenkant) en het volume voor meldingen omhoog.</span>
        </template>
      </div>
    </div>

    <div class="test stack gap-10">
      <span class="test-title">Test of het werkt</span>
      <span class="test-text">Je krijgt binnen een paar seconden een proefmelding met geluid. Komt hij binnen? Dan ben je klaar.</span>
      <button class="btn light" :disabled="!push.subscribed" @click="test">Stuur testmelding</button>
      <span v-if="testSent && push.log[0]" class="test-text" role="status">{{ push.log[0].text }}</span>
      <span class="test-small">Testmeldingen komen niet in het rapport.</span>
    </div>

    <div class="grow" />
    <RouterLink :to="{ name: 'start' }" class="btn primary">Klaar, naar mijn startscherm</RouterLink>
  </main>
</template>

<style scoped>
.top { padding-top: 56px; }
.rows { margin-top: 22px; }
.row { display: flex; align-items: center; gap: 12px; }
.quiet { border: 2px solid var(--warn-line); }
.icon { width: 40px; height: 40px; border-radius: 12px; }
.icon.good { background: var(--ok-bg); color: var(--ok-text); }
.icon.bad { background: #F8DEDC; color: var(--danger); }
.icon.warn { background: var(--warn-bg); color: var(--warn); }
.text { gap: 1px; flex-grow: 1; }
.name { font-size: 15px; font-weight: 600; }
.state { font-size: 13px; font-weight: 700; }
.state.ok { color: var(--ok-text); }
.state.bad { color: var(--danger); }
.turn-on { min-height: 44px; padding: 0 4px; border: none; background: none; font: 700 13px var(--sans); color: var(--ok-text); text-decoration: underline; cursor: pointer; }
.test { margin-top: 22px; padding: 18px; border-radius: 18px; background: var(--primary); color: #FFFFFF; }
.test-title { font-size: 16px; font-weight: 700; }
.test-text { font-size: 14px; color: var(--soft-text); line-height: 1.45; }
.test-small { font-size: 12px; color: var(--soft-text); }
.screen > .btn.primary { margin-top: 18px; }
</style>
