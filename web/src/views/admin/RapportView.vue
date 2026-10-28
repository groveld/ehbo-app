<script setup lang="ts">
// 6.1 · Beheerder: rapport & export. Kerncijfers, de incidenten, en export als PDF (afdrukpagina) en CSV. Plus de testmodus.
import { computed, onMounted, ref } from 'vue';
import { INCIDENT_WHAT, OUTCOMES, REQUEST_KINDS, formatDuration, type Report, type RequestKind } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import { useSave } from '../../composables/useSave.ts';
import { clock } from '../../incidents.ts';
import { useAdminStore } from '../../stores/admin.ts';

const admin = useAdminStore();
const report = ref<Report | null>(null);
const showAll = ref(false);
const loadError = ref('');
const testing = useSave();

async function load() {
  try {
    report.value = await admin.loadReport();
    loadError.value = '';
  } catch (err) {
    loadError.value = navigator.onLine ? (err as Error).message : 'Geen bereik. Het rapport kan alleen met internet.';
  }
}
onMounted(load);

/** Nieuwste eerst, zoals in het schermontwerp. */
const recent = computed(() => [...(report.value?.incidents ?? [])].reverse());
const shown = computed(() => (showAll.value ? recent.value : recent.value.slice(0, 5)));
const outcomes = computed(() => Object.entries(report.value?.totals.byOutcome ?? {}) as [keyof typeof OUTCOMES, number][]);
const requests = computed(() => Object.entries(report.value?.totals.requestsByKind ?? {}) as [RequestKind, number][]);
const OUTCOME_SHORT = { geholpen: 'geholpen', gestopt: 'gestopt', ambulance: 'ambulance', doorverwezen: 'doorverwezen', geweigerd: 'geweigerd', loos: 'loos alarm' } as const;

async function toggleTestMode(on: boolean) {
  if (on && !confirm('Testmodus aanzetten? Alle oproepen en aanvragen tellen dan als proef en komen niet in het rapport. Zet hem uit voordat het evenement begint.')) return;
  await testing.run(() => admin.setTestMode(on));
}
async function deleteTestData() {
  if (!report.value || !confirm(`${report.value.testItems} proefoproepen en -aanvragen wissen? Dit kan niet ongedaan worden.`)) return;
  if (await testing.run(() => admin.deleteTestData())) await load();
}
</script>

<template>
  <AdminPage title="Rapport" :eyebrow="`Beheer · ${admin.state?.event.name ?? ''}`" :back="{ name: 'beheer' }">
    <template #default="{ state }">
      <p v-if="loadError" class="note warn" role="alert">{{ loadError }}</p>
      <p v-else-if="!report" class="small">Laden…</p>
      <template v-else>
        <div class="tiles">
          <div class="fact"><span class="label">Incidenten</span><span class="value">{{ report.totals.incidents }}</span></div>
          <div class="fact"><span class="label">Gem. tot acceptatie</span><span class="value mono">{{ formatDuration(report.totals.avgResponseSeconds) }}</span></div>
          <div class="fact"><span class="label">Gem. tot ter plaatse</span><span class="value mono">{{ formatDuration(report.totals.avgTravelSeconds) }}</span></div>
          <div class="fact"><span class="label">Naar alle eenheden</span><span class="value">{{ report.totals.escalated }}</span></div>
        </div>

        <section class="stack gap-6">
          <span class="section-title">Incidenten</span>
          <div v-if="shown.length" class="list">
            <div v-for="i in shown" :key="i.number" class="list-row row">
              <span class="mono at">{{ clock(i.reportedAt) }}</span>
              <span class="grow"><strong>{{ i.postName.split(' · ')[0] }}</strong> · {{ i.what ? INCIDENT_WHAT[i.what].split(' / ')[0]!.toLowerCase() : 'EHBO' }}</span>
              <span class="outcome" :class="{ muted: !i.outcome }">{{ i.outcome ? OUTCOME_SHORT[i.outcome] : i.status === 'ingetrokken' ? 'ingetrokken' : 'open' }}</span>
            </div>
          </div>
          <p v-else class="small">Nog geen incidenten.</p>
          <button v-if="recent.length > 5" class="add-link" @click="showAll = !showAll">{{ showAll ? 'Minder tonen' : `Alle ${recent.length} bekijken` }}</button>
        </section>

        <section v-if="outcomes.length || requests.length" class="stack gap-6">
          <span class="section-title">Totalen</span>
          <div class="list">
            <div v-for="[key, count] in outcomes" :key="key" class="list-row row"><span class="grow">{{ OUTCOMES[key] }}</span><strong>{{ count }}</strong></div>
            <div v-if="report.totals.maxResponseSeconds !== null" class="list-row row"><span class="grow">Langste tijd tot acceptatie</span><strong class="mono">{{ formatDuration(report.totals.maxResponseSeconds) }}</strong></div>
            <div v-if="report.totals.withdrawn" class="list-row row"><span class="grow">Ingetrokken meldingen</span><strong>{{ report.totals.withdrawn }}</strong></div>
            <div v-for="[kind, count] in requests" :key="kind" class="list-row row"><span class="grow">Aanvragen {{ REQUEST_KINDS[kind].label.toLowerCase() }}</span><strong>{{ count }}</strong></div>
          </div>
        </section>

        <div class="btn-pair">
          <RouterLink :to="{ name: 'beheer-rapport-afdrukken' }" class="btn">PDF-export</RouterLink>
          <a href="/api/admin/report.csv" class="btn" download>CSV-export</a>
        </div>
        <span class="small">PDF: kies in het afdrukvenster "Opslaan als PDF". CSV opent in Excel.</span>
      </template>

      <!-- Testmodus: proefoproepen voor het evenement -->
      <section class="stack gap-8 test">
        <span class="section-title">Testmodus</span>
        <div class="card test-row">
          <span class="stack grow">
            <strong>{{ state.testMode ? 'Testmodus staat aan' : 'Testmodus' }}</strong>
            <span class="small">Oproepen en aanvragen zijn proef: meldingen beginnen met "Test" en ze komen niet in het rapport.</span>
          </span>
          <button
            class="switch" role="switch" :aria-checked="state.testMode" aria-label="Testmodus" :disabled="testing.busy.value"
            @click="toggleTestMode(!state.testMode)"
          />
        </div>
        <p v-if="state.testMode" class="note warn">Zet de testmodus uit voordat het evenement begint.</p>
        <button v-if="report?.testItems" class="btn" :disabled="testing.busy.value" @click="deleteTestData">Proefgegevens wissen ({{ report.testItems }})</button>
        <p v-if="testing.error.value" class="error-text" role="alert">{{ testing.error.value }}</p>
      </section>
    </template>
  </AdminPage>
</template>

<style scoped>
.tiles { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.fact { background: var(--card); border-radius: 14px; padding: 12px; display: flex; flex-direction: column; gap: 2px; }
.fact .label { font-size: 12px; color: var(--muted); }
.fact .value { font-size: 22px; font-weight: 700; }
.row { min-height: 44px; font-size: 14px; }
.at { color: var(--muted); font-size: 13px; }
.outcome { font-size: 12px; font-weight: 600; color: var(--ok-text); }
.outcome.muted { color: var(--muted); }
.test { margin-top: 10px; }
.test-row { display: flex; align-items: center; gap: 12px; }
</style>
