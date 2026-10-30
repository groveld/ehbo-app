<script setup lang="ts">
// One EHBO team in a list: its status, where it is, AED, and a call button.
import { computed } from 'vue';
import { POSITION_MAX_AGE_MS, UNIT_AVAILABILITY, isAway, telHref, type EventPackage, type PackageUnit } from '@ehbo/shared';
import { useLiveStore } from '../stores/live.ts';
import Icon from './Icon.vue';

const props = defineProps<{ pkg: EventPackage; unit: PackageUnit }>();
const live = useLiveStore();

const state = computed(() => live.unitState(props.unit.id));
const incident = computed(() => (state.value?.incidentId != null ? live.incidentById(state.value.incidentId) : null));
const postOf = (id: number | null | undefined) => props.pkg.posts.find((p) => p.id === id);

const status = computed(() => {
  if (incident.value) return { tone: 'busy', label: incident.value.status === 'ter_plaatse' ? 'Ter plaatse' : 'Onderweg' };
  const availability = state.value?.availability ?? 'uit_dienst';
  return { tone: availability, label: UNIT_AVAILABILITY[availability] };
});

/** During a call the post it's going to; otherwise its own place, and for a mobile team how fresh its position is. */
const where = computed(() => {
  if (incident.value) return incident.value.post.name;
  const { unit } = props;
  const home = postOf(unit.postId);
  const base = unit.kind === 'vast' ? postOf(state.value?.stayPostId ?? unit.postId)?.name : home?.name;
  if (unit.kind === 'vast') return base ?? 'Geen post';
  const position = state.value?.position;
  const age = position ? live.serverNow - new Date(position.at).getTime() : Infinity;
  if (age > POSITION_MAX_AGE_MS) return base ? `${base} · geen recente positie` : 'Geen recente positie';
  const away = isAway(unit, state.value ?? undefined, home, live.serverNow);
  const minutes = Math.floor(age / 60_000);
  return `${away ? 'Onderweg' : `Thuis${base ? ` · ${base}` : ''}`} · positie ${minutes ? `${minutes} min oud` : 'net bijgewerkt'}`;
});
const phone = computed(() => props.unit.members[0]?.phone ?? null);
</script>

<template>
  <div class="team-row">
    <span class="text">
      <span class="name">{{ unit.name }}<span class="status" :class="status.tone">{{ status.label }}</span></span>
      <span class="sub">{{ where }}<template v-if="unit.hasAed"> · AED</template></span>
    </span>
    <a v-if="phone" :href="telHref(phone)" class="round" :aria-label="`Bel ${unit.name}`"><Icon name="phone" :size="20" /></a>
  </div>
</template>

<style scoped>
.team-row { display: flex; align-items: center; gap: 10px; min-height: 64px; padding: 10px 12px 10px 14px; background: var(--card); border-radius: 16px; }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex-grow: 1; }
.name { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 15px; font-weight: 700; line-height: 1.25; }
.sub { font-size: 13px; color: var(--muted); }
.status { font-size: 12px; font-weight: 700; padding: 2px 8px; border-radius: 999px; background: var(--soft); color: var(--ink-2); }
.status.vrij { background: var(--ok-bg); color: var(--ok-text); }
.status.pauze { background: var(--warn-bg); color: var(--warn); }
.status.busy { background: #FBE3E1; color: #8A1A14; }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--soft); color: var(--ink); }
</style>
