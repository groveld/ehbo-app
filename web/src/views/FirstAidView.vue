<script setup lang="ts">
// 3.3 · EHBO: het scherm van de EHBO'er. Eigen status, positie, team en de oproepen van vandaag.
import { computed } from 'vue';
import { TEAM_AVAILABILITY, formatPhone, mobilityLabel, telHref, type TeamAvailability } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import StatusBlock from '../components/StatusBlock.vue';
import { useSave } from '../composables/useSave.ts';
import { clock, myDeployments, teamOf } from '../incidents.ts';
import { callNextOf, kmLabel, shiftText } from '../locations.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

const store = usePackageStore();
const live = useLiveStore();
const session = useSessionStore();
const { busy, error, run } = useSave();

/** De gekozen plek als die een eenheid is, anders de eerste eenheid van deze medewerker. */
const teamId = computed(() => live.myTeamIds[0] ?? null);
const team = computed(() => teamOf(store.pkg, teamId.value));
const state = computed(() => (teamId.value !== null ? live.teamState(teamId.value) : null));
const availability = computed<TeamAvailability>(() => state.value?.availability ?? 'off_duty');
const active = computed(() => (state.value?.incidentId ? live.incidentById(state.value.incidentId) : null));

const label = computed(() => {
  const u = team.value;
  if (!u) return '';
  const base = u.locationId !== null ? store.locationById.get(u.locationId)?.name : null;
  return [`EHBO ${u.name}`, u.kind === 'fixed' ? 'fixed' : mobilityLabel(u.mobility), u.kind === 'fixed' ? base : null].filter(Boolean).join(' · ');
});

const block = computed(() => {
  if (active.value) return { tone: 'red' as const, title: 'Bezig met een oproep' };
  if (availability.value === 'available') return { tone: 'green' as const, title: 'Beschikbaar' };
  if (availability.value === 'unavailable') return { tone: 'red' as const, title: 'Niet beschikbaar' };
  return { tone: 'dark' as const, title: 'Uit dienst' };
});
/** During a call you're there but not available, so the buttons say the same as the header. */
const shown = computed<TeamAvailability>(() => (active.value ? 'unavailable' : availability.value));
/** During a call: the status the team goes to once it's over. Picking one during the call plans it. */
const next = computed<TeamAvailability | null>(() => (active.value ? state.value?.nextAvailability ?? 'available' : null));

/** Waar de eenheid voor "dichtstbij" telt. */
const position = computed(() => {
  const u = team.value;
  if (!u) return '–';
  const stay = state.value?.stayLocationId != null ? store.locationById.get(state.value.stayLocationId) : null;
  if (stay) return `${stay.name} (gebleven)`;
  const base = u.locationId !== null ? store.locationById.get(u.locationId) : null;
  if (u.kind === 'mobile') return availability.value === 'off_duty' ? (base ? `Standplaats ${base.name}` : '–') : `GPS${base ? `, anders ${base.name}` : ''}`;
  return base ? [base.name, kmLabel(base)].filter(Boolean).join(' · ') : '–';
});
const shift = computed(() => shiftText(team.value));
/** Someone comes to you: possible while you're there and not busy. */
const canStart = computed(() => availability.value !== 'off_duty' && !active.value);
const teammates = computed(() => team.value?.members.filter((m) => m.phone !== session.me?.phone) ?? []);
const othersFree = computed(() => {
  const others = (live.state?.teams ?? []).filter((u) => u.id !== teamId.value);
  return { free: others.filter((u) => u.availability === 'available' && u.incidentId === null).length, total: others.length };
});
const today = computed(() => (teamId.value !== null ? myDeployments(live.incidents, teamId.value) : []));
const callNext = computed(() => callNextOf(store.pkg, session.me?.phone));

/** The buttons: "Bezet" is shorter to tap than the status it sets, which still reads Niet beschikbaar everywhere. */
const BUTTONS: Record<TeamAvailability, string> = { ...TEAM_AVAILABILITY, unavailable: 'Bezet' };
const setAvailability = (value: TeamAvailability) => teamId.value !== null && run(() => live.setAvailability(teamId.value!, value));
</script>

<template>
  <main class="screen tight">
    <p v-if="!team" class="note warn top-gap">Je staat (nog) niet bij een EHBO-eenheid, of de gegevens van het evenement zijn nog niet geladen.</p>
    <template v-else>
      <StatusBlock :tone="block.tone" :label="label" :title="block.title" />

      <div v-if="state?.closesAt && !active" class="note warn closing gap-top">
        <span class="grow">Je dienst stopt om <strong>{{ clock(state.closesAt) }}</strong>.</span>
        <button class="btn keep" :disabled="busy" @click="run(() => live.keepTeam(teamId!))">In dienst blijven</button>
      </div>
      <RouterLink v-for="i in live.invitations" :key="i.id" :to="{ name: 'dispatch', params: { id: i.id } }" class="btn danger gap-top">
        Oproep · {{ i.location.name }}
      </RouterLink>

      <div class="stack gap-8 gap-top">
        <span class="section-title">Mijn status</span>
        <div class="choice-grid">
          <button
            v-for="(text, key) in BUTTONS" :key="key" class="option" :class="[key, { next: next === key }]"
            :aria-pressed="shown === key" :disabled="busy" @click="setAvailability(key)"
          >{{ text }}</button>
        </div>
        <p v-if="next" class="small">Na deze oproep: <strong>{{ TEAM_AVAILABILITY[next] }}</strong></p>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      </div>

      <div class="list facts-list">
        <div v-if="shift" class="list-row"><span class="grow">Dienst</span><strong>{{ shift }}</strong></div>
        <div class="list-row"><span class="grow">Positie</span><strong>{{ position }}</strong></div>
        <div class="list-row"><span class="grow">Teamleden</span><strong>{{ teammates.map((m) => m.name || formatPhone(m.phone)).join(', ') || 'alleen jij' }}</strong></div>
        <div class="list-row"><span class="grow">Andere eenheden beschikbaar</span><strong>{{ othersFree.free }} van {{ othersFree.total }}</strong></div>
        <!-- De oproepen van vandaag op een eigen scherm, zodat de status en de belknoppen in beeld blijven. -->
        <RouterLink :to="{ name: 'assign' }" class="list-row">
          <span class="grow">Mijn inzetten</span>
          <strong>{{ today.length || 'nog geen' }}</strong>
          <Icon name="forward" :size="16" />
        </RouterLink>
      </div>

      <div class="grow" />
      <!-- De belknoppen blijven onderaan in beeld, ook als de pagina scrolt. -->
      <div class="form-footer">
        <RouterLink v-if="canStart" :to="{ name: 'self-start' }" class="btn go"><Icon name="ehbo" :size="20" />Incident starten</RouterLink>
        <a v-if="callNext" :href="telHref(callNext.phone)" class="btn"><Icon name="phone" :size="20" />{{ callNext.label }}</a>
        <a href="tel:112" class="btn danger"><Icon name="phone" :size="20" />Bel 112</a>
      </div>
    </template>
  </main>
</template>

<style scoped>
.top-gap { margin-top: 24px; }
.gap-top { margin-top: 14px; }
.closing { align-items: center; font-size: 14px; }
.keep { width: auto; flex-shrink: 0; padding: 0 14px; }
.option[aria-pressed="true"] { font-weight: 700; }
/* Green is here and available, red is here but not available, dark is not here. Fixed colors, not the event's. */
.option[aria-pressed="true"] { color: #FFFFFF; }
.option.available[aria-pressed="true"] { border-color: var(--ok); background: var(--ok); }
.option.unavailable[aria-pressed="true"] { border-color: var(--danger); background: var(--danger); }
.option.off_duty[aria-pressed="true"] { border-color: var(--off); background: var(--off); }
/* The status after the call: its colour, slowly pulsing. */
.option.available { --glow: var(--ok); }
.option.unavailable { --glow: var(--danger); }
.option.off_duty { --glow: var(--off); }
.option.next { animation: next-status 2.4s ease-in-out infinite; }
.option.next:not([aria-pressed="true"]) { border: 2px solid var(--glow); color: var(--glow); font-weight: 700; }
@keyframes next-status {
  0%, 100% { box-shadow: 0 0 0 0 transparent; }
  50% { box-shadow: 0 0 0 3px color-mix(in srgb, var(--glow) 30%, transparent), 0 0 14px color-mix(in srgb, var(--glow) 40%, transparent); }
}
@media (prefers-reduced-motion: reduce) {
  .option.next { animation: none; box-shadow: 0 0 0 3px color-mix(in srgb, var(--glow) 30%, transparent); }
}
.facts-list { margin-top: 14px; }
.facts-list .list-row { min-height: 50px; font-size: 14px; }
/* De onderrand van het scherm telt al; anders staan de knoppen dubbel zo ver van de tabbalk. */
.form-footer { margin: 14px 0 -16px; }
</style>
