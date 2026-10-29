<script setup lang="ts">
// 2.2 · Medewerker: op beginscherm zetten. Alleen zo krijg je meldingen en werkt de app zonder bereik.
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import Icon from '../components/Icon.vue';
import { deviceLabel, iosTooOld, isAndroid, isIOS } from '../platform.ts';
import { useSessionStore } from '../stores/session.ts';

interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const session = useSessionStore();
// Zo heet de app onder het icoon (de korte naam uit het manifest).
const appName = computed(() => session.event?.style.shortName || session.event?.name || 'EHBO-app');
const installPrompt = ref<BeforeInstallPromptEvent | null>(null);
const installed = ref(false);

function onBeforeInstallPrompt(e: Event) {
  e.preventDefault();
  installPrompt.value = e as BeforeInstallPromptEvent;
}
function onInstalled() {
  installed.value = true;
  installPrompt.value = null;
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
  <main class="screen">
    <div class="stack gap-14 top">
      <img :src="session.event?.brand.icon ?? '/icons/icon-192.png'" alt="" width="64" height="64" class="square-logo">
      <h1 class="title">Zet de app eerst op je beginscherm</h1>
      <p class="lead">Alleen dan krijg je meldingen en werkt de app ook zonder bereik. Het kost 10 seconden.</p>
      <span class="chip">Herkend: {{ deviceLabel }}</span>
    </div>

    <p v-if="installed" class="note ok steps-gap">Geïnstalleerd. Open <strong>{{ appName }}</strong> nu vanaf je beginscherm.</p>

    <div v-else-if="isIOS" class="card stack gap-14 steps-gap">
      <div class="step"><span class="badge num">1</span><span class="grow">Tik onderin op <strong>Deel</strong></span><Icon name="share" :size="22" /></div>
      <div class="divider" />
      <div class="step"><span class="badge num">2</span><span class="grow">Kies <strong>Zet op beginscherm</strong></span><Icon name="addSquare" :size="22" /></div>
      <div class="divider" />
      <div class="step"><span class="badge num">3</span><span class="grow">Open <strong>{{ appName }}</strong> vanaf je beginscherm</span></div>
    </div>

    <div v-else-if="isAndroid" class="stack gap-12 steps-gap">
      <button v-if="installPrompt" class="btn primary" @click="install">Installeren</button>
      <div v-else class="card stack gap-14">
        <div class="step"><span class="badge num">1</span><span class="grow">Tik rechtsboven op het menu <strong>⋮</strong></span></div>
        <div class="divider" />
        <div class="step"><span class="badge num">2</span><span class="grow">Kies <strong>App installeren</strong> of <strong>Toevoegen aan startscherm</strong></span></div>
        <div class="divider" />
        <div class="step"><span class="badge num">3</span><span class="grow">Open <strong>{{ appName }}</strong> vanaf je startscherm</span></div>
      </div>
    </div>

    <div v-else class="card steps-gap">
      <p class="lead">Open deze pagina op je telefoon, of installeer via het installatie-icoon in de adresbalk.</p>
    </div>

    <p v-if="iosTooOld" class="note warn hint">Je iPhone heeft iOS 16.4 of nieuwer nodig voor meldingen. Werk iOS eerst bij via Instellingen › Algemeen › Software-update.</p>
    <p v-else-if="!installed" class="note info hint">Daarna vraagt de app om meldingen en locatie toe te staan.</p>

    <div class="grow" />
    <a href="/aanmelden?browser=1" class="small test-link">Alleen testen in de browser (voor beheer)</a>
  </main>
</template>

<style scoped>
.top { padding-top: 64px; }
.square-logo { width: 64px; height: 64px; border-radius: 18px; }
.steps-gap { margin-top: 22px; }
.hint { margin-top: 14px; }
.step { display: flex; gap: 14px; align-items: center; font-size: 15px; }
.num { width: 32px; height: 32px; background: var(--primary); color: #FFFFFF; font-size: 14px; }
.test-link { align-self: center; padding: 8px; color: var(--muted); }
</style>
