<script setup lang="ts">
// 2.4 · Nummer herkend → rol bevestigen. Elke functie krijgt straks een eigen tab; kiezen of wisselen hoeft niet.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { formatPhone } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
const router = useRouter();
const me = computed(() => session.me!);

const preview = computed(() => {
  switch (me.value.home) {
    case 'ehbo': return 'Oproepen voor jouw EHBO-eenheid, en het volledige overzicht: alle posten en medewerkers op de kaart, die je direct kunt bellen of waar je naartoe kunt navigeren.';
    case 'post': return 'De hulpknop voor jouw post, en het volledige overzicht: alle posten en medewerkers op de kaart, die je direct kunt bellen of waar je naartoe kunt navigeren.';
    default: return 'Het volledige overzicht: het kernteam, alle posten en medewerkers op de kaart, die je direct kunt bellen of waar je naartoe kunt navigeren.';
  }
});

function start() {
  router.push({ name: 'toestemmingen' });
}

async function notMe() {
  await session.logout();
  router.replace({ name: 'aanmelden' });
}
</script>

<template>
  <main v-if="session.me" class="screen">
    <div class="stack gap-6 top">
      <span class="recognised"><Icon name="check" :size="18" />Nummer herkend</span>
      <h1 class="title">Hoi{{ session.firstName ? ` ${session.firstName}` : '' }}</h1>
      <span class="mono phone">{{ formatPhone(me.phone) }}</span>
    </div>

    <div class="stack gap-10 places">
      <span class="label">Jij staat ingepland als</span>
      <div v-for="a in me.assignments" :key="`${a.kind}-${a.postId ?? a.unitId ?? a.title}`" class="card place outlined">
        <span class="badge letter" :style="{ background: a.color }">{{ a.letter }}</span>
        <span class="stack text">
          <span class="name">{{ a.title }}</span>
          <span v-if="a.detail" class="detail">{{ a.detail }}</span>
          <span v-if="a.times" class="small">{{ a.times }}</span>
        </span>
      </div>
      <span v-if="me.assignments.filter((a) => a.kind === 'post' || a.kind === 'ehbo').length > 1" class="small">Elke functie krijgt onderaan een eigen tab, zodat je niet hoeft te wisselen.</span>
    </div>

    <div class="note ok stack gap-6 preview">
      <strong>Wat je straks ziet</strong>
      <span>{{ preview }}</span>
    </div>

    <div class="grow" />
    <button class="btn primary" @click="start">Klopt, start</button>
    <button class="btn link" @click="notMe">Dit ben ik niet</button>
  </main>
</template>

<style scoped>
.top { padding-top: 72px; }
.recognised { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--ok-text); }
.phone { font-size: 15px; color: var(--muted); }
.places { margin-top: 28px; }
.label { font-size: 14px; font-weight: 600; }
.place { display: flex; align-items: center; gap: 14px; width: 100%; text-align: left; font: inherit; color: inherit; cursor: default; }
.letter { width: 48px; height: 48px; color: #FFFFFF; font-size: 17px; }
.text { gap: 2px; flex-grow: 1; }
.name { font-size: 16px; font-weight: 700; }
.detail { font-size: 14px; color: var(--ink-2); }
.preview { margin-top: 22px; font-size: 14px; line-height: 1.45; }
</style>
