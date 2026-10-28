<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useLiveStore } from './stores/live.ts';
import { usePackageStore } from './stores/package.ts';
import { usePushStore } from './stores/push.ts';
import { useSessionStore } from './stores/session.ts';
import { applyTheme } from './theme.ts';

const push = usePushStore();
const pkg = usePackageStore();
const session = useSessionStore();
const live = useLiveStore();
const route = useRoute();
const router = useRouter();

// Kleuren en naam van het evenement; zonder bereik uit de bewaarde gegevens.
watch(() => session.event, applyTheme, { immediate: true });

// Sessie verlopen of nummer niet meer ingepland: terug naar het begin.
watch(() => session.me, (me) => {
  if (!me && route.meta.staff) router.replace({ name: 'welkom' });
});

// Nieuwe oproep voor mijn eenheid terwijl de app open is: meteen naar het oproepscherm, met trillen.
// Niet midden in het afronden van een andere oproep; daar staat de oproep wel op stand-by.
const seen = new Set<number>(live.invitations.map((i) => i.id));
watch(() => live.invitations.map((i) => i.id), (ids) => {
  const fresh = ids.find((id) => !seen.has(id));
  for (const id of ids) seen.add(id);
  if (fresh === undefined || route.name === 'afronden') return;
  navigator.vibrate?.([400, 150, 400, 150, 800]);
  if (!(route.name === 'oproep' && route.params.id === String(fresh))) router.push({ name: 'oproep', params: { id: fresh } });
});

onMounted(() => {
  push.registerWorker();
  session.loadEvent();
  if (session.me) session.refresh();
  // Vaste gegevens en kaart bijwerken bij openen, bij terugkeren naar de app, en elke vijf minuten.
  void pkg.refresh();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void pkg.refresh();
  });
  setInterval(() => void pkg.refresh(), 5 * 60 * 1000);
});
</script>

<template>
  <RouterView />
</template>
