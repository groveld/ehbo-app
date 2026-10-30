<script setup lang="ts">
// 4.2 · Post: verzoek verstuurd, en 4.6 · hulp onderweg + escalatie. Ook voor de coördinator, die hier een eenheid kan toewijzen.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { OUTCOMES, formatKm, telHref } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import StatusBlock from '../components/StatusBlock.vue';
import { useSave } from '../composables/useSave.ts';
import { clock, incidentSummary, travelMinutes, unitOf } from '../incidents.ts';
import { coordinatorOf } from '../posts.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

const props = defineProps<{ id: string }>();
const store = usePackageStore();
const live = useLiveStore();
const session = useSessionStore();
const router = useRouter();
const { busy, error, run } = useSave();

const incident = computed(() => live.incidentById(Number(props.id)));
const post = computed(() => (incident.value ? store.postById.get(incident.value.postId) : undefined));
const coordinator = computed(() => coordinatorOf(store.pkg));
const isCoordinator = computed(() => coordinator.value?.phone === session.me?.phone || session.me?.isAdmin);
const atPost = computed(() => live.myPostIds.includes(incident.value?.postId ?? -1));
const canChange = computed(() => atPost.value || isCoordinator.value);

const pending = computed(() => incident.value?.dispatches.filter((d) => !d.declinedAt && !d.acceptedAt) ?? []);
const accepted = computed(() => incident.value?.dispatches.filter((d) => d.acceptedAt) ?? []);
const left = computed(() => (incident.value ? live.secondsLeft(incident.value) : null));
const unitName = (id: number) => unitOf(store.pkg, id)?.name ?? 'Eenheid';

/** Eerste eenheid die komt: naam, nummer en vanaf waar. */
const helper = computed(() => {
  const i = incident.value;
  const unit = unitOf(store.pkg, i?.unitId ?? null);
  if (!i || !unit) return null;
  const from = unit.postId !== null ? store.postById.get(unit.postId)?.name : null;
  const dispatch = i.dispatches.find((d) => d.unitId === unit.id);
  return {
    name: i.acceptedBy?.name ?? unit.members[0]?.name ?? unit.name,
    phone: i.acceptedBy?.phone ?? unit.members[0]?.phone ?? null,
    detail: [unit.name, from ? `vanaf ${from}` : unit.kind === 'mobiel' ? 'mobiel' : null].filter(Boolean).join(' · '),
    minutes: travelMinutes(dispatch?.distanceKm ?? null, unit),
  };
});
/** Bij niet aanspreekbaar kan er een tweede eenheid met AED komen. */
const others = computed(() => accepted.value.filter((d) => d.unitId !== incident.value?.unitId).map((d) => unitOf(store.pkg, d.unitId)).filter(Boolean));
const emergency = computed(() => store.pkg?.emergencyNumbers.filter((n) => n.number.replace(/\D/g, '') !== '112') ?? []);

/** Eenheden die de coördinator kan inzetten: niet al bezig met een andere oproep. */
const assignable = computed(() => (store.pkg?.units ?? []).filter((u) => {
  const s = live.unitState(u.id);
  return !accepted.value.some((d) => d.unitId === u.id) && (s?.incidentId == null || s.incidentId === incident.value?.id);
}));

async function withdraw() {
  if (!incident.value || !confirm('Melding intrekken? De EHBO hoeft dan niet meer te komen.')) return;
  if (await run(() => live.withdraw(incident.value!.id))) router.back();
}
// Eén stap omhoog: je post, Meldingen of EHBO (navigation.ts).
const back = () => router.back();
</script>

<template>
  <main class="screen tight">
    <p v-if="!incident || !post" class="note warn top-gap">Deze melding staat (nog) niet op deze telefoon. <button class="add-link" @click="live.refresh()">Opnieuw laden</button></p>

    <!-- 4.2 · Verstuurd: we zoeken een EHBO'er -->
    <template v-else-if="incident.status === 'verstuurd'">
      <StatusBlock tone="orange" :label="`Melding verstuurd · ${clock(incident.sentAt)}`" title="We zoeken een EHBO'er" sub="Blijf bij de persoon. Je ziet hier zodra iemand komt." />
      <p v-if="incident.aed" class="note warn gap-top"><strong>Niet aanspreekbaar: bel ook 112.</strong> De dichtstbijzijnde eenheid met AED is opgeroepen.</p>

      <div class="card steps">
        <div class="step"><span class="mark done"><Icon name="check" :size="14" /></span><span class="grow">Melding ontvangen door de server</span></div>
        <template v-if="incident.stage === 'dichtstbij'">
          <div v-for="d in pending" :key="d.unitId" class="step">
            <span class="mark busy" /><span class="grow"><strong>{{ unitName(d.unitId) }}</strong> ({{ d.reason === 'aed' ? 'AED' : 'dichtstbij' }}) wordt opgeroepen</span>
            <span v-if="left !== null" class="mono countdown">nog {{ left }} s</span>
          </div>
          <div class="step later"><span class="mark" /><span class="grow">Daarna alle beschikbare eenheden tegelijk</span></div>
        </template>
        <div v-else class="step">
          <span class="mark busy" />
          <span class="grow">{{ pending.length ? `Alle beschikbare eenheden worden opgeroepen (${pending.length})` : 'Geen beschikbare eenheid gevonden; de coördinator is gewaarschuwd' }}</span>
        </div>
        <div class="step" :class="{ later: incident.stage === 'dichtstbij' }"><span class="mark" :class="{ done: incident.stage === 'alle' }" /><span class="grow">Evenementcoördinator heeft een kopie</span></div>
      </div>

      <div class="card yours">
        <span class="small">Jouw melding</span>
        <span class="summary">{{ incidentSummary(incident) }}</span>
        <span v-if="incident.note" class="small">{{ incident.note }}</span>
        <RouterLink v-if="canChange" :to="{ name: 'aanvullen', params: { incidentId: incident.id } }" class="add-link">Aanvullen</RouterLink>
      </div>
    </template>

    <!-- 4.6 · Geaccepteerd: hulp is onderweg -->
    <template v-else-if="incident.status === 'geaccepteerd' || incident.status === 'ter_plaatse'">
      <StatusBlock
        tone="green"
        :label="incident.status === 'ter_plaatse' ? `Ter plaatse · ${clock(incident.onSiteAt)}` : `Geaccepteerd · ${clock(incident.acceptedAt)}`"
        :title="incident.status === 'ter_plaatse' ? 'EHBO is er' : 'Hulp is onderweg'"
        :sub="incident.status === 'ter_plaatse' ? incidentSummary(incident) : helper?.minutes ? `Verwacht over ± ${helper.minutes} min` : undefined"
      >
        <template #label><Icon name="check" :size="16" />{{ incident.status === 'ter_plaatse' ? `Ter plaatse · ${clock(incident.onSiteAt)}` : `Geaccepteerd · ${clock(incident.acceptedAt)}` }}</template>
      </StatusBlock>

      <div v-if="helper" class="card helper">
        <span class="cross"><Icon name="cross" :size="24" /></span>
        <span class="stack grow">
          <span class="name">{{ helper.name }}</span>
          <span class="small">{{ helper.detail }}</span>
        </span>
        <a v-if="helper.phone" :href="telHref(helper.phone)" class="round green" :aria-label="`Bel ${helper.name}`"><Icon name="phone" :size="18" /></a>
      </div>
      <div v-for="u in others" :key="u!.id" class="card helper second">
        <span class="stack grow"><span class="name">{{ u!.name }}</span><span class="small">komt ook{{ u!.hasAed ? ', met AED' : '' }}</span></span>
        <a v-if="u!.members[0]" :href="telHref(u!.members[0].phone)" class="round green" :aria-label="`Bel ${u!.name}`"><Icon name="phone" :size="18" /></a>
      </div>
      <p v-if="incident.aed && !accepted.some((d) => unitOf(store.pkg, d.unitId)?.hasAed)" class="note warn gap-top">Nog geen eenheid met AED onderweg. Bel 112.</p>

      <div class="card timeline">
        <div class="row"><span class="dot on" /><span class="at">{{ clock(incident.sentAt) }}</span><span>Melding verstuurd</span></div>
        <div class="row"><span class="dot on" /><span class="at">{{ clock(incident.acceptedAt) }}</span><span>Geaccepteerd door {{ unitName(incident.unitId!) }}</span></div>
        <div class="row" :class="{ muted: !incident.onSiteAt }"><span class="dot" :class="{ on: incident.onSiteAt }" /><span class="at">{{ clock(incident.onSiteAt) }}</span><span>Ter plaatse</span></div>
      </div>

      <div class="stack gap-8 escalate">
        <span class="section-title">Wordt het erger? Escaleer</span>
        <a href="tel:112" class="btn danger"><Icon name="phone" :size="20" />Bel 112</a>
        <div v-if="emergency.length" class="btn-pair">
          <a v-for="n in emergency.slice(0, 2)" :key="n.number" :href="telHref(n.number)" class="btn outline"><strong>{{ n.label }}</strong></a>
        </div>
      </div>
    </template>

    <!-- Afgerond of ingetrokken -->
    <template v-else>
      <StatusBlock
        :tone="incident.status === 'afgerond' ? 'green' : 'dark'"
        :label="`${incident.status === 'afgerond' ? 'Afgerond' : 'Ingetrokken'} · ${clock(incident.closedAt)}`"
        :title="incident.status === 'afgerond' ? 'Klaar' : 'Melding ingetrokken'"
        :sub="incident.outcome ? OUTCOMES[incident.outcome] : incidentSummary(incident)"
      />
      <div class="card timeline gap-top">
        <div v-for="(e, n) in incident.events" :key="n" class="row"><span class="at">{{ clock(e.at) }}</span><span>{{ e.text }}</span></div>
      </div>
    </template>

    <!-- Coördinator: zelf een eenheid inzetten (na telefonisch overleg) -->
    <section v-if="incident && isCoordinator && incident.status !== 'afgerond' && incident.status !== 'ingetrokken'" class="stack gap-8 assign">
      <span class="section-title">{{ incident.status === 'verstuurd' ? 'Zelf een eenheid inzetten' : 'Extra eenheid inzetten' }}</span>
      <div class="list">
        <div v-for="u in assignable" :key="u.id" class="list-row">
          <span class="main">
            <span class="title-line">{{ u.name }}</span>
            <span class="sub">
              {{ live.unitState(u.id)?.availability === 'vrij' ? 'beschikbaar' : live.unitState(u.id)?.availability === 'pauze' ? 'niet beschikbaar' : 'uit dienst' }}<template
                v-if="incident.dispatches.find((d) => d.unitId === u.id)?.distanceKm != null"
              > · {{ formatKm(incident.dispatches.find((d) => d.unitId === u.id)!.distanceKm!) }} km</template>
            </span>
          </span>
          <a v-if="u.members[0]" :href="telHref(u.members[0].phone)" class="round" :aria-label="`Bel ${u.name}`"><Icon name="phone" :size="17" /></a>
          <button class="btn small-btn" :disabled="busy" @click="run(() => live.assign(incident!.id, u.id))">Inzetten</button>
        </div>
      </div>
      <span class="small">Inzetten telt als aangenomen. Bel de eenheid eerst.</span>
    </section>

    <div class="grow" />
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>
    <div class="stack gap-8 bottom">
      <template v-if="incident && (incident.status === 'verstuurd')">
        <a href="tel:112" class="btn danger">Erger geworden? Bel 112</a>
      </template>
      <a v-if="coordinator && !isCoordinator && incident && incident.status !== 'afgerond' && incident.status !== 'ingetrokken'" :href="telHref(coordinator.phone)" class="btn">Bel evenementcoördinator</a>
      <button v-if="incident && canChange && ['verstuurd', 'geaccepteerd', 'ter_plaatse'].includes(incident.status)" class="btn link muted" :disabled="busy" @click="withdraw">
        {{ incident.status === 'verstuurd' ? 'Melding intrekken' : 'Melding intrekken (niet meer nodig)' }}
      </button>
      <button v-if="!incident || incident.status === 'afgerond' || incident.status === 'ingetrokken'" class="btn primary" @click="back">Terug</button>
    </div>
  </main>
</template>

<style scoped>
.top-gap { margin-top: 24px; }
.gap-top { margin-top: 14px; }
.steps { display: flex; flex-direction: column; gap: 12px; margin-top: 14px; font-size: 14px; }
.step { display: flex; gap: 12px; align-items: center; }
.step.later { color: var(--muted); }
.mark { width: 22px; height: 22px; flex-shrink: 0; border-radius: 50%; border: 2px solid #A8A59C; display: flex; align-items: center; justify-content: center; }
.mark.done { border: none; background: var(--ok); color: #FFFFFF; }
.mark.busy { border: 3px solid var(--warn-line); }
.countdown { font-size: 13px; color: var(--warn); }
.yours { display: flex; flex-direction: column; gap: 2px; margin-top: 10px; }
.summary { font-size: 15px; font-weight: 600; }
.helper { display: flex; align-items: center; gap: 14px; margin-top: 14px; border-radius: 18px; }
.helper.second { margin-top: 8px; }
.cross { width: 48px; height: 48px; flex-shrink: 0; border-radius: 14px; background: var(--ok); color: #FFFFFF; display: flex; align-items: center; justify-content: center; }
.name { font-size: 16px; font-weight: 700; }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; background: var(--soft); color: var(--ink); }
.round.green { background: var(--ok); color: #FFFFFF; }
.timeline { margin-top: 10px; font-size: 14px; }
.timeline .row { align-items: center; }
.timeline .muted { color: var(--muted); }
.dot { width: 10px; height: 10px; flex-shrink: 0; border-radius: 50%; border: 2px solid #A8A59C; }
.dot.on { border: none; background: var(--ok); }
.escalate { padding-top: 18px; }
.btn.outline { background: var(--card); border: 1px solid var(--line); height: 56px; }
.assign { padding-top: 18px; }
.small-btn { width: auto; height: 44px; padding: 0 14px; }
.bottom { padding-top: 14px; }
.muted { color: var(--muted); }
</style>
