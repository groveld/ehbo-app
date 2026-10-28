<script setup lang="ts">
import { onMounted } from 'vue';
import CheckScreen from './components/CheckScreen.vue';
import InstallScreen from './components/InstallScreen.vue';
import { browserTest, isStandalone } from './platform.ts';
import { usePushStore } from './stores/push.ts';

const push = usePushStore();
const showApp = isStandalone || browserTest;

onMounted(() => {
  push.registerWorker();
  if (!showApp) push.loadInfo();
});
</script>

<template>
  <main class="wrap">
    <header class="top">
      <img src="/icons/icon-192.png" alt="" width="48" height="48" class="logo">
      <div>
        <p class="eyebrow">Testversie · {{ push.info?.version ?? '…' }}</p>
        <h1>EHBO-app</h1>
      </div>
    </header>

    <CheckScreen v-if="showApp" />
    <InstallScreen v-else />

    <a href="tel:112" class="btn danger sos">Noodgeval: bel 112</a>
  </main>
</template>
