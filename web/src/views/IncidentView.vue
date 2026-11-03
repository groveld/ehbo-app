<script setup lang="ts">
// 4.2 · Post: verzoek verstuurd, en 4.6 · hulp onderweg + escalatie. Ook voor de coördinator, die hier een eenheid kan toewijzen.
import { computed } from 'vue';
import { useRouter } from 'vue-router';
import { formatKm, telHref } from '@ehbo/shared';
import ActivityLog from '../components/ActivityLog.vue';
import Icon from '../components/Icon.vue';
import NotOnPhone from '../components/NotOnPhone.vue';
import StatusBlock from '../components/StatusBlock.vue';
import { confirmDialog } from '../composables/useDialog.ts';
import { useSave } from '../composables/useSave.ts';
import { clock, incidentLog, incidentSummary, postOf, travelMinutes, teamOf } from '../incidents.ts';
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
const post = computed(() => (incident.value ? postOf(store.postById, incident.value) : undefined));
const coordinator = computed(() => coordinatorOf(store.pkg));
const isCoordinator = computed(() => coordinator.value?.phone === session.me?.phone || session.me?.isAdmin);
const atPost = computed(() => live.myPostIds.includes(incident.value?.postId ?? -1));
/** The post, or who asked for help from where they were. */
const canChange = computed(() => atPost.value || isCoordinator.value || incident.value?.reportedBy === session.me?.phone);

const pending = computed(() => incident.value?.dispatches.filter((d) => !d.declinedAt && !d.acceptedAt) ?? []);
const accepted = computed(() => incident.value?.dispatches.filter((d) => d.acceptedAt) ?? []);
const left = computed(() => (incident.value ? live.secondsLeft(incident.value) : null));
const teamName = (id: number) => teamOf(store.pkg, id)?.name ?? 'Eenheid';

/** Eerste eenheid die komt: naam, nummer en vanaf waar. */
const helper = computed(() => {
  const i = incident.value;
  const team = teamOf(store.pkg, i?.teamId ?? null);
  if (!i || !team) return null;
  const from = team.postId !== null ? store.postById.get(team.postId)?.name : null;
  const dispatch = i.dispatches.find((d) => d.teamId === team.id);
  return {
    name: i.acceptedBy?.name ?? team.members[0]?.name ?? team.name,
    phone: i.acceptedBy?.phone ?? team.members[0]?.phone ?? null,
    detail: [team.name, from ? `vanaf ${from}` : team.kind === 'mobile' ? 'mobile' : null].filter(Boolean).join(' · '),
    minutes: travelMinutes(dispatch?.distanceKm ?? null, team),
  };
});
/** Bij niet aanspreekbaar kan er een tweede eenheid met AED komen. */
const others = computed(() => accepted.value.filter((d) => d.teamId !== incident.value?.teamId).map((d) => teamOf(store.pkg, d.teamId)).filter(Boolean));
const emergency = computed(() => store.pkg?.emergencyNumbers.filter((n) => n.number.replace(/\D/g, '') !== '112') ?? []);

/** Eenheden die de coördinator kan inzetten: niet al bezig met een andere oproep. */
const assignable = computed(() => (store.pkg?.teams ?? []).filter((u) => {
  const s = live.teamState(u.id);
  return !accepted.value.some((d) => d.teamId === u.id) && (s?.incidentId == null || s.incidentId === incident.value?.id);
}));

async function withdraw() {
  if (!incident.value || !await confirmDialog({ title: 'Melding intrekken?', text: 'De EHBO hoeft dan niet meer te komen.', confirm: 'Melding intrekken', cancel: 'Niet intrekken', tone: 'danger' })) return;
  if (await run(() => live.withdraw(incident.value!.id))) router.back();
}
// Eén stap omhoog: je post, Meldingen of EHBO (navigation.ts).
const back = () => router.back();
</script>

<template>
  <main class="screen tight">
    <NotOnPhone v-if="!incident || !post" class="top-gap">Deze melding staat (nog) niet op deze telefoon.</NotOnPhone>

    <!-- 4.2 · Verstuurd: we zoeken een EHBO'er -->
    <template v-else-if="incident.status === 'sent'">
      <StatusBlock tone="orange" :label="`Melding verstuurd · ${clock(incident.sentAt)}`" title="We zoeken een EHBO'er" />
      <p v-if="incident.aed" class="note warn gap-top"><strong>Niet aanspreekbaar: bel ook 112.</strong> De dichtstbijzijnde eenheid met AED is opgeroepen.</p>

      <div class="card steps">
        <div class="step"><span class="mark done"><Icon name="check" :size="14" /></span><span class="grow">Melding ontvangen door de server</span></div>
        <template v-if="incident.stage === 'nearest'">
          <div v-for="d in pending" :key="d.teamId" class="step">
            <span class="mark busy" /><span class="grow"><strong>{{ teamName(d.teamId) }}</strong> ({{ d.reason === 'aed' ? 'AED' : 'dichtstbij' }}) wordt opgeroepen</span>
            <span v-if="left !== null" class="mono countdown">nog {{ left }} s</span>
          </div>
          <div class="step later"><span class="mark" /><span class="grow">Daarna alle beschikbare eenheden tegelijk</span></div>
        </template>
        <div v-else class="step">
          <span class="mark busy" />
          <span class="grow">{{ pending.length ? `Alle beschikbare eenheden worden opgeroepen (${pending.length})` : 'Geen beschikbare eenheid gevonden; de coördinator is gewaarschuwd' }}</span>
        </div>
        <div class="step" :class="{ later: incident.stage === 'nearest' }"><span class="mark" :class="{ done: incident.stage === 'all' }" /><span class="grow">Evenementcoördinator heeft een kopie</span></div>
      </div>

      <div class="card yours">
        <span class="small">Jouw melding</span>
        <span class="summary">{{ incidentSummary(incident) }}</span>
        <span v-if="incident.note" class="small">{{ incident.note }}</span>
        <RouterLink v-if="canChange" :to="{ name: 'add-to-incident', params: { incidentId: incident.id } }" class="add-link">Aanvullen</RouterLink>
      </div>
    </template>

    <!-- 4.6 · Geaccepteerd: hulp is onderweg -->
    <template v-else-if="incident.status === 'accepted' || incident.status === 'on_site'">
      <StatusBlock
        tone="green"
        :label="incident.status === 'on_site' ? `Ter plaatse · ${clock(incident.onSiteAt)}` : `Geaccepteerd · ${clock(incident.acceptedAt)}`"
        :title="incident.status === 'on_site' ? 'EHBO is er' : 'Hulp is onderweg'"
      >
        <template #label><Icon name="check" :size="16" />{{ incident.status === 'on_site' ? `Ter plaatse · ${clock(incident.onSiteAt)}` : `Geaccepteerd · ${clock(incident.acceptedAt)}` }}</template>
      </StatusBlock>

      <div v-if="helper" class="card helper">
        <span class="cross"><Icon name="ehbo" :size="24" /></span>
        <span class="stack grow">
          <span class="name">{{ helper.name }}</span>
          <span class="small">{{ helper.detail }}<template v-if="helper.minutes && incident.status === 'accepted'"> · verwacht over ± {{ helper.minutes }} min</template></span>
        </span>
        <a v-if="helper.phone" :href="telHref(helper.phone)" class="round green" :aria-label="`Bel ${helper.name}`"><Icon name="phone" :size="18" /></a>
      </div>
      <div v-for="u in others" :key="u!.id" class="card helper second">
        <span class="stack grow"><span class="name">{{ u!.name }}</span><span class="small">komt ook{{ u!.hasAed ? ', met AED' : '' }}</span></span>
        <a v-if="u!.members[0]" :href="telHref(u!.members[0].phone)" class="round green" :aria-label="`Bel ${u!.name}`"><Icon name="phone" :size="18" /></a>
      </div>
      <p v-if="incident.aed && !accepted.some((d) => teamOf(store.pkg, d.teamId)?.hasAed)" class="note warn gap-top">Nog geen eenheid met AED onderweg. Bel 112.</p>

      <div class="card yours">
        <span class="small">Melding</span>
        <span class="summary">{{ incidentSummary(incident) }}</span>
        <span v-if="incident.note" class="small">{{ incident.note }}</span>
        <RouterLink v-if="canChange" :to="{ name: 'add-to-incident', params: { incidentId: incident.id } }" class="add-link">Aanvullen</RouterLink>
      </div>

      <ActivityLog :entries="incidentLog(incident)" />

      <div class="stack gap-8 escalate">
        <span class="section-title">Wordt het erger? Escaleer</span>
        <a href="tel:112" class="btn danger"><Icon name="phone" :size="20" />Bel 112</a>
        <div v-if="emergency.length" class="btn-pair">
          <a v-for="n in emergency.slice(0, 2)" :key="n.number" :href="telHref(n.number)" class="btn"><strong>{{ n.label }}</strong></a>
        </div>
      </div>
    </template>

    <!-- Afgerond of ingetrokken -->
    <template v-else>
      <StatusBlock
        :tone="incident.status === 'closed' ? 'green' : 'dark'"
        :label="`${incident.status === 'closed' ? 'Afgerond' : 'Ingetrokken'} · ${clock(incident.closedAt)}`"
        :title="incident.status === 'closed' ? 'Klaar' : 'Melding ingetrokken'"
      />
      <div class="card yours gap-top">
        <span class="small">{{ incident.post.name }}</span>
        <span class="summary">{{ incidentSummary(incident) }}</span>
      </div>
      <ActivityLog :entries="incidentLog(incident)" />
    </template>

    <!-- Coördinator: zelf een eenheid inzetten (na telefonisch overleg) -->
    <section v-if="incident && isCoordinator && incident.status !== 'closed' && incident.status !== 'withdrawn'" class="stack gap-8 assign">
      <span class="section-title">{{ incident.status === 'sent' ? 'Zelf een eenheid inzetten' : 'Extra eenheid inzetten' }}</span>
      <div class="list">
        <div v-for="u in assignable" :key="u.id" class="list-row">
          <span class="main">
            <span class="title-line">{{ u.name }}</span>
            <span class="sub">
              {{ live.teamState(u.id)?.availability === 'available' ? 'beschikbaar' : live.teamState(u.id)?.availability === 'unavailable' ? 'niet beschikbaar' : 'uit dienst' }}<template
                v-if="incident.dispatches.find((d) => d.teamId === u.id)?.distanceKm != null"
              > · {{ formatKm(incident.dispatches.find((d) => d.teamId === u.id)!.distanceKm!) }} km</template>
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
      <template v-if="incident && (incident.status === 'sent')">
        <a href="tel:112" class="btn danger">Erger geworden? Bel 112</a>
      </template>
      <a v-if="coordinator && !isCoordinator && incident && incident.status !== 'closed' && incident.status !== 'withdrawn'" :href="telHref(coordinator.phone)" class="btn">Bel evenementcoördinator</a>
      <button v-if="incident && canChange && ['sent', 'accepted', 'on_site'].includes(incident.status)" class="btn link muted" :disabled="busy" @click="withdraw">
        {{ incident.status === 'sent' ? 'Melding intrekken' : 'Melding intrekken (niet meer nodig)' }}
      </button>
      <button v-if="!incident || incident.status === 'closed' || incident.status === 'withdrawn'" class="btn primary" @click="back">Terug</button>
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
.escalate { padding-top: 18px; }
.assign { padding-top: 18px; }
.small-btn { width: auto; height: 44px; padding: 0 14px; }
.bottom { padding-top: 14px; }
.muted { color: var(--muted); }
</style>
