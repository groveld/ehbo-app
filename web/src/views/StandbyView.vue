<script setup lang="ts">
// 3.3 · EHBO'er: stand-by. Eigen status, positie, team en de oproepen van vandaag.
import { computed } from 'vue';
import { UNIT_AVAILABILITY, formatPhone, telHref, type UnitAvailability } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import StatusBlock from '../components/StatusBlock.vue';
import { useSave } from '../composables/useSave.ts';
import { clock, incidentSummary, unitOf } from '../incidents.ts';
import { coordinatorOf, coreTeamMember, kmLabel } from '../posts.ts';
import { isOpen, useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

const store = usePackageStore();
const live = useLiveStore();
const session = useSessionStore();
const { busy, error, run } = useSave();

/** De gekozen plek als die een eenheid is, anders de eerste eenheid van deze medewerker. */
const unitId = computed(() => live.myUnitIds[0] ?? null);
const unit = computed(() => unitOf(store.pkg, unitId.value));
const state = computed(() => (unitId.value !== null ? live.unitState(unitId.value) : null));
const availability = computed<UnitAvailability>(() => state.value?.availability ?? 'uit_dienst');
const active = computed(() => (state.value?.incidentId ? live.incidentById(state.value.incidentId) : null));

const MOBILITY = { te_voet: 'te voet', fiets: 'fiets', auto: 'auto', anders: 'mobiel' } as const;
const label = computed(() => {
  const u = unit.value;
  if (!u) return '';
  const base = u.postId !== null ? store.postById.get(u.postId)?.name : null;
  return [u.name, u.kind === 'vast' ? 'vast' : `mobiel · ${MOBILITY[u.mobility ?? 'anders']}`, u.kind === 'vast' ? base : null].filter(Boolean).join(' · ');
});

const block = computed(() => {
  if (active.value) return { tone: 'red' as const, title: 'Bezig met een oproep', sub: store.postById.get(active.value.postId)?.name ?? '' };
  if (availability.value === 'vrij') return { tone: 'green' as const, title: 'Beschikbaar', sub: 'Je krijgt oproepen uit de buurt. Houd de telefoon bij je.' };
  if (availability.value === 'pauze') return { tone: 'red' as const, title: 'Niet beschikbaar', sub: 'Je krijgt geen oproepen.' };
  return { tone: 'dark' as const, title: 'Uit dienst', sub: 'Je krijgt geen oproepen.' };
});

/** Waar de eenheid voor "dichtstbij" telt. */
const position = computed(() => {
  const u = unit.value;
  if (!u) return '–';
  const stay = state.value?.stayPostId != null ? store.postById.get(state.value.stayPostId) : null;
  if (stay) return `${stay.name} (gebleven)`;
  const base = u.postId !== null ? store.postById.get(u.postId) : null;
  if (u.kind === 'mobiel') return availability.value === 'uit_dienst' ? (base ? `Standplaats ${base.name}` : '–') : `GPS${base ? `, anders ${base.name}` : ''}`;
  return base ? [base.name, kmLabel(base.km)].filter(Boolean).join(' · ') : '–';
});
const teammates = computed(() => unit.value?.members.filter((m) => m.phone !== session.me?.phone) ?? []);
const othersFree = computed(() => {
  const others = (live.state?.units ?? []).filter((u) => u.id !== unitId.value);
  return { free: others.filter((u) => u.availability === 'vrij' && u.incidentId === null).length, total: others.length };
});
const today = computed(() => live.incidents.filter((i) => !isOpen(i) && i.dispatches.some((d) => d.unitId === unitId.value && d.acceptedAt)));
const ehboCoordinator = computed(() => coreTeamMember(store.pkg, 'EHBO-coördinator'));
const coordinator = computed(() => coordinatorOf(store.pkg));
/** De volgende in de lijn: de EHBO-coördinator, of de evenementcoördinator als je zelf EHBO-coördinator bent. */
const callNext = computed(() => {
  const me = session.me?.phone;
  if (ehboCoordinator.value && ehboCoordinator.value.phone !== me) return { label: 'Bel EHBO-coördinator', phone: ehboCoordinator.value.phone };
  if (coordinator.value && coordinator.value.phone !== me) return { label: 'Bel evenementcoördinator', phone: coordinator.value.phone };
  return null;
});

const setAvailability = (value: UnitAvailability) => unitId.value !== null && run(() => live.setAvailability(unitId.value!, value));
</script>

<template>
  <main class="screen tight">
    <p v-if="!unit" class="note warn top-gap">Je staat (nog) niet bij een EHBO-eenheid, of de gegevens van het evenement zijn nog niet geladen.</p>
    <template v-else>
      <StatusBlock :tone="block.tone" :label="label" :title="block.title" :sub="block.sub" />

      <RouterLink v-if="active" :to="{ name: 'oproep', params: { id: active.id } }" class="btn danger gap-top">
        Naar de oproep · {{ incidentSummary(active) }}
      </RouterLink>
      <RouterLink v-for="i in live.invitations" :key="i.id" :to="{ name: 'oproep', params: { id: i.id } }" class="btn danger gap-top">
        Oproep · {{ store.postById.get(i.postId)?.name }}
      </RouterLink>

      <div class="stack gap-8 gap-top">
        <span class="section-title">Mijn status</span>
        <div class="choice-grid">
          <button
            v-for="(text, key) in UNIT_AVAILABILITY" :key="key" class="option" :class="key"
            :aria-pressed="availability === key" :disabled="busy" @click="setAvailability(key)"
          >{{ text }}</button>
        </div>
        <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      </div>

      <div class="list facts-list">
        <div class="list-row"><span class="grow">Positie</span><strong>{{ position }}</strong></div>
        <div class="list-row"><span class="grow">Teamleden</span><strong>{{ teammates.map((m) => m.name || formatPhone(m.phone)).join(', ') || 'alleen jij' }}</strong></div>
        <div class="list-row"><span class="grow">Andere eenheden beschikbaar</span><strong>{{ othersFree.free }} van {{ othersFree.total }}</strong></div>
      </div>

      <div v-if="today.length" class="stack gap-6 gap-top">
        <span class="section-title">Vandaag</span>
        <div class="list">
          <RouterLink v-for="i in today" :key="i.id" :to="{ name: 'melding', params: { id: i.id } }" class="list-row today">
            <span class="main">
              <span class="title-line">{{ store.postById.get(i.postId)?.name }}</span>
              <span class="sub">{{ clock(i.reportedAt) }} · {{ incidentSummary(i) }}</span>
            </span>
            <span class="tag" :class="{ ok: i.status === 'afgerond' }">{{ i.status === 'afgerond' ? 'afgerond' : 'ingetrokken' }}</span>
            <Icon name="forward" :size="16" />
          </RouterLink>
        </div>
      </div>

      <div class="grow" />
      <a v-if="callNext" :href="telHref(callNext.phone)" class="btn"><Icon name="phone" :size="20" />{{ callNext.label }}</a>
      <a href="tel:112" class="btn danger sos"><Icon name="phone" :size="20" />Bel 112</a>
    </template>
  </main>
</template>

<style scoped>
.top-gap { margin-top: 24px; }
.gap-top { margin-top: 14px; }
.option[aria-pressed="true"] { font-weight: 700; }
.option.vrij[aria-pressed="true"] { border-color: var(--ok); background: var(--ok-bg); color: #0A4D33; }
.option.pauze[aria-pressed="true"] { border-color: var(--danger); background: #FBE3E1; color: #8A1A14; }
.option.uit_dienst[aria-pressed="true"] { border-color: var(--ink); background: #E8E8EA; color: var(--ink); }
.facts-list { margin-top: 14px; }
.facts-list .list-row { min-height: 50px; font-size: 14px; }
.today { min-height: 56px; color: var(--ink); text-decoration: none; }
.sos { margin-top: 10px; }
</style>
