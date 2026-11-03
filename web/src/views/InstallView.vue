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

    <template v-else-if="isIOS">
      <p class="note warn steps-gap"><span><strong>Op deze pagina zit geen knop.</strong> De plaatjes zijn voorbeelden. Je tikt in de balk van Safari, onder in je scherm.</span></p>
      <ol class="steps">
        <li>Zoek in de balk van Safari het deel-icoon <Icon name="share" :size="18" class="example" />. Zie je het niet? Tik dan eerst op <strong class="example-text">•••</strong>.</li>
        <li>Kies <strong>Zet op beginscherm</strong> <Icon name="addSquare" :size="18" class="example" />. Staat het er niet bij? Veeg de lijst omhoog of kies <strong>Meer</strong>.</li>
        <li>Tik rechtsboven op <strong>Voeg toe</strong>.</li>
        <li>Open <strong>{{ appName }}</strong> vanaf je beginscherm.</li>
      </ol>
      <p class="toolbar-hint" aria-hidden="true">In de balk hieronder<span class="arrow">↓</span></p>
    </template>

    <div v-else-if="isAndroid" class="stack gap-12 steps-gap">
      <button v-if="installPrompt" class="btn primary" @click="install">Installeren</button>
      <template v-else>
        <p class="note warn"><span><strong>Op deze pagina zit geen knop.</strong> Je tikt in de balk van je browser, boven in je scherm.</span></p>
        <ol class="steps">
          <li>Tik rechtsboven in je browser op de drie puntjes <strong class="example-text">⋮</strong>.</li>
          <li>Kies <strong>App installeren</strong> of <strong>Toevoegen aan startscherm</strong>.</li>
          <li>Open <strong>{{ appName }}</strong> vanaf je startscherm.</li>
        </ol>
      </template>
    </div>

    <div v-else class="card steps-gap">
      <p class="lead">Open deze pagina op je telefoon, of installeer via het installatie-icoon in de adresbalk.</p>
    </div>

    <p v-if="iosTooOld" class="note warn hint">Je iPhone heeft iOS 16.4 of nieuwer nodig voor meldingen. Werk iOS eerst bij via Instellingen › Algemeen › Software-update.</p>
    <p v-else-if="!installed" class="note info hint">Daarna vraagt de app om meldingen en locatie toe te staan.</p>

    <div class="grow" />
    <a href="/login?browser=1" class="small test-link" :class="{ 'above-hint': isIOS && !installed }">Alleen testen in de browser (voor beheer)</a>
  </main>
</template>

<style scoped>
.top { padding-top: 64px; }
.square-logo { width: 64px; height: 64px; border-radius: 18px; }
.steps-gap { margin-top: 22px; }
.hint { margin-top: 14px; }
/* Plain numbered text, with the icons inside the sentence: nothing here may look like a button. */
.steps { margin: 16px 0 0; padding-left: 24px; display: flex; flex-direction: column; gap: 12px; font-size: 15px; line-height: 1.45; }
.steps li::marker { font-weight: 700; }
.example { display: inline-block; vertical-align: -3px; color: var(--muted); pointer-events: none; }
.example-text { color: var(--muted); }
/* Points out of the page, at the Safari toolbar under it. */
.toolbar-hint {
  position: fixed; left: 0; right: 0; bottom: 0; padding: 6px 0 4px; background: var(--bg); display: flex; flex-direction: column; align-items: center;
  font-size: 13px; font-weight: 600; color: var(--muted); pointer-events: none;
}
.arrow { font-size: 24px; line-height: 1; animation: nudge 1.2s ease-in-out infinite; }
@keyframes nudge { 50% { transform: translateY(5px); } }
@media (prefers-reduced-motion: reduce) { .arrow { animation: none; } }
.test-link { align-self: center; padding: 8px; color: var(--muted); }
.above-hint { margin-bottom: 56px; }
</style>
