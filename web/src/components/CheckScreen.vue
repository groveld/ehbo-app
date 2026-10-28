<script setup lang="ts">
// Getoond als de app geïnstalleerd is (of in testmodus): controle, meldingen en logboek.
import { computed, onMounted } from 'vue';
import { isIOS, isStandalone } from '../platform.ts';
import { usePushStore } from '../stores/push.ts';

const push = usePushStore();

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

onMounted(() => push.init());
</script>

<template>
  <div class="card">
    <h2>Controle</h2>
    <dl class="checks">
      <div v-for="check in checks" :key="check.label">
        <dt>{{ check.label }}</dt>
        <dd :class="check.tone">{{ check.value }}</dd>
      </div>
    </dl>
  </div>

  <div class="card">
    <h2>Meldingen</h2>
    <p class="muted">{{ help }}</p>
    <button v-if="!push.subscribed" class="btn primary" :disabled="push.permission === 'unsupported'" @click="push.enable">
      Meldingen aanzetten
    </button>
    <div class="row">
      <button class="btn" :disabled="!push.subscribed" @click="push.testPush(0)">Testmelding nu</button>
      <button class="btn" :disabled="!push.subscribed" @click="push.testPush(10)">Over 10 s</button>
    </div>
    <p class="muted small">Tip: tik op "Over 10 s" en vergrendel direct je telefoon. Zo test je een melding op het vergrendelscherm.</p>
    <button v-if="push.subscribed" class="link small" @click="push.disable">Meldingen uitzetten</button>
  </div>

  <div class="card">
    <h2>Logboek</h2>
    <ol class="log" aria-live="polite">
      <li v-for="entry in push.log" :key="entry.id">{{ entry.time }} · {{ entry.text }}</li>
    </ol>
  </div>
</template>
