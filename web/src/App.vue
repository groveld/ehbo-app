<script setup lang="ts">
import { onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePushStore } from './stores/push.ts';
import { useSessionStore } from './stores/session.ts';

const push = usePushStore();
const session = useSessionStore();
const route = useRoute();
const router = useRouter();

// Sessie verlopen of nummer niet meer ingepland: terug naar het begin.
watch(() => session.me, (me) => {
  if (!me && route.meta.staff) router.replace({ name: 'welkom' });
});

onMounted(() => {
  push.registerWorker();
  session.loadEvent();
  if (session.me) session.refresh();
});
</script>

<template>
  <RouterView />
</template>
