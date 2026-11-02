<script setup lang="ts">
// For the coordinator and admins: everything open or closed at once, for when people forget, and the end of the day.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import Icon from '../components/Icon.vue';
import { confirmDialog, messageDialog } from '../composables/useDialog.ts';
import { useSave } from '../composables/useSave.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();
const { busy, error, run } = useSave();

const counts = computed(() => {
  const posts = store.pkg?.posts ?? [];
  const units = store.pkg?.units ?? [];
  return {
    posts: posts.length,
    openPosts: posts.filter((p) => live.postOpen(p.id, p.isOpen)).length,
    units: units.length,
    onDuty: units.filter((u) => (live.unitState(u.id)?.availability ?? 'uit_dienst') !== 'uit_dienst').length,
  };
});

async function act(action: 'open-all' | 'close-all' | 'close-day') {
  let skipped: string[] = [];
  const ok = await run(async () => { skipped = await live.control(action); });
  if (ok && skipped.length) void messageDialog({ title: 'Niet alles is gesloten', text: `Nog bezig met een oproep: ${skipped.join(', ')}.`, confirm: 'Begrepen' });
}

async function openAll() {
  const { posts, openPosts, units, onDuty } = counts.value;
  if (await confirmDialog({
    title: `${posts - openPosts} posten en ${units - onDuty} EHBO-eenheden openen?`,
    text: 'Eenheden gaan op Beschikbaar, ook als de EHBO\'er er misschien nog niet is. Wie Niet beschikbaar staat, blijft zo staan. Iedereen krijgt een melding.',
    confirm: 'Alles openen',
  })) await act('open-all');
}

async function closeAll() {
  const { openPosts, onDuty } = counts.value;
  if (await confirmDialog({
    title: `${openPosts} posten en ${onDuty} EHBO-eenheden sluiten?`,
    text: 'Bijvoorbeeld voor een lange pauze in het programma. Wat met een oproep bezig is, blijft open.',
    reassure: 'Je kunt daarna alles weer openen.',
    confirm: 'Alles sluiten',
    tone: 'danger',
  })) await act('close-all');
}

async function closeDay() {
  if (await confirmDialog({
    title: 'Dag sluiten?',
    text: 'Alle posten gaan dicht, alle eenheden uit dienst en open aanvragen worden afgehandeld. Iedereen krijgt een melding.',
    reassure: 'Iedereen blijft aangemeld, en je kunt morgen alles weer openen.',
    confirm: 'Dag sluiten',
    tone: 'danger',
  })) await act('close-day');
}
</script>

<template>
  <main class="screen tight">
    <header class="page-header">
      <button class="icon-btn" aria-label="Terug" @click="router.back()"><Icon name="back" /></button>
      <h1>Openen en sluiten</h1>
    </header>

    <div class="facts" style="--facts: 2">
      <div class="fact"><span class="value mono">{{ counts.openPosts }}/{{ counts.posts }}</span><span class="label">Posten open</span></div>
      <div class="fact"><span class="value mono">{{ counts.onDuty }}/{{ counts.units }}</span><span class="label">EHBO in dienst</span></div>
    </div>

    <p class="note top">Na de geplande eindtijd sluiten posten en eenheden vanzelf, 10 minuten na een waarschuwing. Nooit tijdens een open melding.</p>
    <p v-if="live.offline" class="note warn top">Dit kan alleen met verbinding.</p>
    <p v-if="error" class="error-text top" role="alert">{{ error }}</p>

    <div class="stack gap-10 top">
      <button class="btn primary" :disabled="busy || live.offline" @click="openAll">Alles openen</button>
      <button class="btn" :disabled="busy || live.offline" @click="closeAll">Alles sluiten</button>
      <button class="btn danger" :disabled="busy || live.offline" @click="closeDay">Dag sluiten</button>
    </div>
  </main>
</template>

<style scoped>
.top { margin-top: 14px; }
</style>
