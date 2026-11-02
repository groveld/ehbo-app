<script setup lang="ts">
// Offline, on every screen in the same place: on the edge of the tab bar, or at the bottom left without one. Online says nothing; that's what you expect.
// Bottom left because the participant page has Bel EHBO at the bottom right.
import { computed } from 'vue';
import { messageDialog } from '../composables/useDialog.ts';
import { useLiveStore } from '../stores/live.ts';
import { useSessionStore } from '../stores/session.ts';

defineProps<{ tabs: boolean }>();
const live = useLiveStore();
const session = useSessionStore();

const waiting = computed(() => live.queue.length + live.outbox.length);

function explain() {
  const staff = session.me
    ? `Je kunt gewoon doorwerken. ${waiting.value ? `${waiting.value} ${waiting.value === 1 ? 'wijziging wacht' : 'wijzigingen wachten'} op verbinding en ${waiting.value === 1 ? 'gaat' : 'gaan'} vanzelf weg.` : 'Wat je wijzigt, gaat vanzelf weg zodra er weer verbinding is.'} Je ziet de laatst bekende stand. Bellen en de kaart werken gewoon.`
    : 'Je ziet de laatst bekende gegevens. Bellen en de kaart werken gewoon.';
  void messageDialog({ title: 'Geen verbinding', text: staff, confirm: 'Begrepen' });
}
</script>

<template>
  <button v-if="live.offline" class="offline-pill" :class="{ tabs }" @click="explain">
    <span class="dot" />Offline<template v-if="waiting"> · {{ waiting }}</template>
  </button>
</template>

<style scoped>
.offline-pill {
  position: fixed; z-index: 20; left: 16px; bottom: max(20px, env(safe-area-inset-bottom));
  height: 28px; padding: 0 12px; border: none; border-radius: 999px; background: var(--off); color: #FFFFFF;
  display: flex; align-items: center; gap: 6px; font: 700 13px var(--sans); cursor: pointer; box-shadow: 0 2px 8px rgba(0, 0, 0, .3);
}
/* On the edge of the tab bar, in the gap above it that every screen keeps free. */
.offline-pill.tabs { left: 50%; transform: translateX(-50%); bottom: calc(var(--tabbar, 0px) - 10px); }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--warn-line); }
</style>
