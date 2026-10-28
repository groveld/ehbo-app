<script setup lang="ts">
// 4.9 · Geen bereik: terugval op bellen. De melding staat klaar en gaat vanzelf weg zodra er bereik is.
import { computed, watch } from 'vue';
import { useRouter } from 'vue-router';
import { formatKm, telHref } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import StatusBlock from '../components/StatusBlock.vue';
import { coordinatorOf, unitsByDistance } from '../posts.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

const props = defineProps<{ clientId: string }>();
const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();

const item = computed(() => live.outbox.find((i) => i.clientId === props.clientId));
const refused = computed(() => live.refused[props.clientId]);
const post = computed(() => store.postById.get(item.value?.postId ?? -1));
const coordinator = computed(() => coordinatorOf(store.pkg));
/** Op afstand; wie volgens de laatst bekende stand uit dienst is, laten we weg. */
const units = computed(() => (store.pkg && post.value
  ? unitsByDistance(store.pkg, post.value, (id) => live.unitState(id)?.availability === 'uit_dienst').filter((u) => u.unit.members.length)
  : []));
const first = computed(() => units.value[0]);
const rest = computed(() => units.value.slice(1, 3));

// Alsnog aangekomen: door naar de gewone melding.
watch(() => live.delivered[props.clientId], (id) => {
  if (id) router.replace({ name: 'melding', params: { id } });
}, { immediate: true });
</script>

<template>
  <main class="screen tight">
    <StatusBlock tone="dark" label="Geen internet" title="Bel de EHBO direct" sub="De automatische oproep wacht op bereik. Bellen werkt wel." class="grey">
      <template #label><Icon name="warning" :size="16" />Geen internet</template>
    </StatusBlock>

    <div class="stack gap-10 calls">
      <a v-if="first" :href="telHref(first.unit.members[0]!.phone)" class="call nearest">
        <span class="icon"><Icon name="phone" :size="22" /></span>
        <span class="stack grow">
          <span class="who">Bel {{ first.unit.name }}</span>
          <span class="sub">Dichtstbij · {{ first.post.name }} · {{ formatKm(first.km) }} km</span>
        </span>
      </a>
      <a v-if="coordinator" :href="telHref(coordinator.phone)" class="call">
        <span class="stack grow"><span class="who">Bel evenementcoördinator</span><span class="sub">{{ coordinator.name }}</span></span>
      </a>
      <a v-for="u in rest" :key="u.unit.id" :href="telHref(u.unit.members[0]!.phone)" class="call">
        <span class="stack grow"><span class="who">Bel {{ u.unit.name }}</span><span class="sub">Reserve · {{ formatKm(u.km) }} km</span></span>
      </a>
      <p v-if="!first && !coordinator" class="note warn">Geen nummers op deze telefoon. Bel 112 als het nodig is.</p>
    </div>

    <p v-if="refused" class="note warn waiting" role="alert"><Icon name="warning" :size="18" /><span>De melding is niet aangenomen: {{ refused }}. Bel de EHBO.</span></p>
    <p v-else-if="item" class="note warn waiting"><Icon name="bell" :size="18" /><span>Melding staat klaar en gaat automatisch weg zodra er bereik is.</span></p>
    <button v-if="item" class="btn link" @click="live.flush()">Nu opnieuw proberen</button>

    <div class="grow" />
    <a href="tel:112" class="btn danger sos">Levensgevaar? Bel 112</a>
  </main>
</template>

<style scoped>
.grey { background: #3E434B; }
.grey :deep(.label) { color: #FFFFFF; }
.grey :deep(.sub) { color: #DCDDE0; }
.calls { padding-top: 16px; }
.call { display: flex; align-items: center; gap: 14px; padding: 14px; border-radius: 16px; background: var(--card); border: 1px solid var(--line); color: var(--ink); text-decoration: none; }
.call.nearest { background: var(--ok); border-color: var(--ok); color: #FFFFFF; }
.icon { width: 44px; height: 44px; flex-shrink: 0; border-radius: 12px; background: #FFFFFF; color: var(--ok); display: flex; align-items: center; justify-content: center; }
.who { font-size: 16px; font-weight: 700; }
.nearest .who { font-size: 17px; }
.sub { font-size: 13px; color: var(--muted); }
.nearest .sub { color: #FFFFFF; }
.waiting { margin-top: 14px; align-items: center; }
</style>
