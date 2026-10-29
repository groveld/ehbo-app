<script setup lang="ts">
// Controle van de installatie: service worker, meldingen, locatie (met een GPS-test) en server, met een logboek. Via het menu.
import { computed, onMounted } from 'vue';
import Icon from '../components/Icon.vue';
import { useGpsFix } from '../composables/useGpsFix.ts';
import { isIOS, isStandalone } from '../platform.ts';
import { useLiveStore } from '../stores/live.ts';
import { useLocationStore } from '../stores/location.ts';
import { usePushStore } from '../stores/push.ts';

const push = usePushStore();
const location = useLocationStore();
const live = useLiveStore();
const gps = useGpsFix();

const LOCATION: Record<string, [string, Tone]> = {
  granted: ['toegestaan', 'ok'], denied: ['geweigerd', 'bad'], unsupported: ['niet ondersteund', 'bad'], prompt: ['nog niet gevraagd', 'pending'],
};

async function testGps() {
  const fix = await gps.start();
  if (fix) void location.check();
}

type Tone = 'ok' | 'bad' | 'pending' | '';

const permissionCheck = computed((): [string, Tone] => {
  switch (push.permission) {
    case 'granted': return ['toegestaan', 'ok'];
    case 'denied': return ['geweigerd', 'bad'];
    case 'unsupported': return ['niet ondersteund', 'bad'];
    default: return ['nog niet gevraagd', 'pending'];
  }
});

const checks = computed((): { label: string; value: string; tone: Tone }[] => [
  { label: 'Geïnstalleerd', value: isStandalone ? 'ja' : 'nee (testmodus)', tone: isStandalone ? 'ok' : 'pending' },
  {
    label: 'Service worker',
    value: push.workerState === 'onbekend' ? '–' : push.workerState,
    tone: push.workerState === 'actief' ? 'ok' : push.workerState === 'onbekend' ? '' : 'bad',
  },
  { label: 'Meldingen', value: permissionCheck.value[0], tone: permissionCheck.value[1] },
  { label: 'Locatie', value: LOCATION[location.permission]![0], tone: LOCATION[location.permission]![1] },
  ...(live.myUnitIds.length ? [{ label: 'Positie delen (mobiele EHBO)', value: live.sharingUnit != null ? 'actief' : 'uit (alleen in dienst)', tone: (live.sharingUnit != null ? 'ok' : '') as Tone }] : []),
  {
    label: 'Aangemeld bij server',
    value: push.serverSubscription,
    tone: push.serverSubscription === 'ja' ? 'ok' : push.serverSubscription === 'fout' ? 'bad' : 'pending',
  },
  {
    label: 'Server',
    value: push.serverState === 'bereikbaar' ? `bereikbaar · ${push.info?.version}` : push.serverState === 'onbekend' ? '–' : push.serverState,
    tone: push.serverState === 'bereikbaar' ? 'ok' : push.serverState === 'onbekend' ? '' : 'bad',
  },
]);

const help = computed(() => {
  if (push.permission === 'unsupported') {
    return isIOS ? 'Open de app vanaf je beginscherm (iOS 16.4 of nieuwer).' : 'Deze browser ondersteunt geen pushmeldingen.';
  }
  if (push.permission === 'denied') {
    return isIOS
      ? 'Meldingen zijn geweigerd. Zet ze aan via Instellingen › Meldingen › EHBO-app.'
      : 'Meldingen zijn geweigerd. Zet ze aan via de app-instellingen van je telefoon (Meldingen).';
  }
  return 'Zet meldingen aan en stuur jezelf een testmelding.';
});

onMounted(() => {
  push.init();
  void location.check();
});
</script>

<template>
  <main class="screen tight">
    <header class="header">
      <RouterLink :to="{ name: 'menu' }" aria-label="Terug" class="icon-btn"><Icon name="back" /></RouterLink>
      <h1 class="heading">Meldingen, locatie en controle</h1>
    </header>

    <div class="stack gap-10">
      <div class="card">
        <dl class="checks">
          <div v-for="check in checks" :key="check.label">
            <dt>{{ check.label }}</dt>
            <dd :class="check.tone">{{ check.value }}</dd>
          </div>
        </dl>
      </div>

      <div class="card stack gap-10">
        <h2 class="section-title">Meldingen</h2>
        <p class="small">{{ help }}</p>
        <button v-if="!push.subscribed" class="btn primary" :disabled="push.permission === 'unsupported'" @click="push.enable">
          Meldingen aanzetten
        </button>
        <div class="pair">
          <button class="btn" :disabled="!push.subscribed" @click="push.testPush(0)">Testmelding nu</button>
          <button class="btn" :disabled="!push.subscribed" @click="push.testPush(10)">Over 10 s</button>
        </div>
        <p class="small">Tip: tik op "Over 10 s" en vergrendel direct je telefoon. Zo test je een melding op het vergrendelscherm.</p>
        <button v-if="push.subscribed" class="btn link" @click="push.disable">Meldingen uitzetten</button>
      </div>

      <div class="card stack gap-10">
        <h2 class="section-title">GPS</h2>
        <p v-if="location.permission === 'denied'" class="small">{{ isIOS ? 'Locatie is geweigerd. Zet het aan via Instellingen › Privacy › Locatievoorzieningen.' : 'Locatie is geweigerd. Zet het aan via de app-instellingen van je telefoon (Locatie).' }}</p>
        <button v-if="location.permission === 'prompt'" class="btn primary" @click="location.request">Locatie aanzetten</button>
        <button class="btn" :disabled="gps.measuring.value" @click="testGps">
          <Icon name="gps" :size="20" />{{ gps.measuring.value ? 'Meten…' : 'Test GPS' }}
        </button>
        <dl v-if="gps.best.value" class="checks">
          <div><dt>Positie</dt><dd class="mono">{{ gps.best.value.lat.toFixed(5) }}, {{ gps.best.value.lng.toFixed(5) }}</dd></div>
          <div><dt>Nauwkeurigheid</dt><dd :class="gps.best.value.accuracyM <= 15 ? 'ok' : gps.best.value.accuracyM <= 50 ? 'pending' : 'bad'">± {{ gps.best.value.accuracyM }} m</dd></div>
        </dl>
        <p v-if="gps.error.value" class="error-text" role="alert">{{ gps.error.value }}</p>
      </div>

      <div class="card stack gap-8">
        <h2 class="section-title">Logboek</h2>
        <ol class="log" aria-live="polite">
          <li v-for="entry in push.log" :key="entry.id">{{ entry.time }} · {{ entry.text }}</li>
        </ol>
      </div>
    </div>
  </main>
</template>

<style scoped>
.header { display: flex; align-items: center; gap: 4px; padding: 14px 0 6px; margin-left: -4px; }
.heading { font-size: 20px; font-weight: 700; }
.section-title { font-size: 16px; font-weight: 700; }
.checks { margin: 0; }
.checks div { display: flex; justify-content: space-between; gap: 12px; padding: 10px 0; border-top: 1px solid var(--divider); }
.checks div:first-child { border-top: none; padding-top: 0; }
.checks dt { color: var(--ink-2); font-size: 14px; }
.checks dd { margin: 0; font-weight: 600; font-size: 14px; text-align: right; }
.ok { color: var(--ok); } .bad { color: var(--danger); } .pending { color: var(--warn); }
.pair { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
.log { margin: 0; padding: 0; list-style: none; font: 12px/1.4 var(--mono); color: var(--ink-2); max-height: 260px; overflow: auto; }
.log li { padding: 4px 0; border-top: 1px solid var(--divider); word-break: break-word; }
</style>
