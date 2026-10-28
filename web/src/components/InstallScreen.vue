<script setup lang="ts">
// Getoond als de app niet vanaf het beginscherm is geopend.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import { deviceLabel, iosTooOld, isAndroid, isIOS } from '../platform.ts';
import { usePushStore } from '../stores/push.ts';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const push = usePushStore();
const installPrompt = ref<BeforeInstallPromptEvent | null>(null);

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault();
  installPrompt.value = e as BeforeInstallPromptEvent;
}
function onInstalled() {
  push.addLog('App geïnstalleerd. Open hem nu vanaf je beginscherm.');
}

async function install() {
  const prompt = installPrompt.value;
  if (!prompt) return;
  await prompt.prompt();
  await prompt.userChoice;
  installPrompt.value = null;
}

onMounted(() => {
  window.addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.addEventListener('appinstalled', onInstalled);
});
onBeforeUnmount(() => {
  window.removeEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  window.removeEventListener('appinstalled', onInstalled);
});
</script>

<template>
  <section class="card">
    <h2>Zet de app eerst op je beginscherm</h2>
    <p class="muted">Alleen dan krijg je meldingen en werkt de app ook zonder bereik.</p>
    <p class="chip">{{ deviceLabel }}</p>

    <div v-if="isIOS">
      <ol class="steps">
        <li>Tik onderin op <strong>Deel</strong> <span aria-hidden="true">(vierkant met pijl omhoog)</span></li>
        <li>Kies <strong>Zet op beginscherm</strong></li>
        <li>Open <strong>EHBO-app</strong> vanaf je beginscherm</li>
      </ol>
      <p v-if="iosTooOld" class="warn">Je iPhone heeft iOS 16.4 of nieuwer nodig voor meldingen. Werk iOS eerst bij via Instellingen › Algemeen › Software-update.</p>
    </div>

    <div v-else-if="isAndroid">
      <button v-if="installPrompt" class="btn primary" @click="install">Installeren</button>
      <ol v-else class="steps">
        <li>Tik rechtsboven op het menu <strong>⋮</strong></li>
        <li>Kies <strong>App installeren</strong> of <strong>Toevoegen aan startscherm</strong></li>
        <li>Open <strong>EHBO-app</strong> vanaf je startscherm</li>
      </ol>
    </div>

    <div v-else>
      <p>Open deze pagina op je telefoon, of installeer via het installatie-icoon in de adresbalk.</p>
    </div>

    <a href="?browser=1" class="link small">Alleen testen in de browser (voor beheer)</a>
  </section>
</template>
