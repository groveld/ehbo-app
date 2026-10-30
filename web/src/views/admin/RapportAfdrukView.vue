<script setup lang="ts">
// Rapport als afdrukpagina: "Opslaan als PDF" in het afdrukvenster geeft het PDF-rapport. Op A4, met het groot logo.
import { computed, nextTick, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { INCIDENT_WHAT, OUTCOMES, REQUEST_KINDS, formatDuration, formatKm, type Report, type RequestKind } from '@ehbo/shared';
import { formatDate } from '../../format.ts';
import { clock } from '../../incidents.ts';
import { useAdminStore } from '../../stores/admin.ts';
import { useSessionStore } from '../../stores/session.ts';

const admin = useAdminStore();
const session = useSessionStore();
const router = useRouter();
const report = ref<Report | null>(null);
const error = ref('');
const print = () => window.print();

const outcomes = computed(() => Object.entries(report.value?.totals.byOutcome ?? {}) as [keyof typeof OUTCOMES, number][]);
const requests = computed(() => Object.entries(report.value?.totals.requestsByKind ?? {}) as [RequestKind, number][]);
const period = computed(() => {
  const e = report.value?.event;
  if (!e?.startDate) return '';
  return e.endDate && e.endDate !== e.startDate ? `${formatDate(e.startDate)} t/m ${formatDate(e.endDate)}` : formatDate(e.startDate);
});

onMounted(async () => {
  try {
    report.value = await admin.loadReport();
    await nextTick();
    // Even wachten op het logo, anders staat het niet op de PDF.
    await Promise.all([...document.images].map((img) => (img.complete ? null : img.decode().catch(() => null))));
    window.print();
  } catch (err) {
    error.value = (err as Error).message;
  }
});
</script>

<template>
  <main class="print">
    <div class="no-print actions">
      <button class="btn" @click="router.back()">Terug</button>
      <button class="btn primary" :disabled="!report" @click="print">Afdrukken of opslaan als PDF</button>
    </div>
    <p v-if="error" class="note warn">{{ error }}</p>

    <template v-if="report">
      <header class="head">
        <div>
          <h1>Rapport {{ report.event.name }}</h1>
          <p>{{ period }}</p>
          <p class="meta">Gemaakt op {{ new Date(report.generatedAt).toLocaleString('nl-NL', { timeZone: 'Europe/Amsterdam' }) }}</p>
        </div>
        <img v-if="session.event?.brand.logo" :src="session.event.brand.logo" alt="" class="logo">
      </header>

      <section>
        <h2>Evenement</h2>
        <table class="pairs">
          <tbody>
            <tr><th>Posten</th><td>{{ report.counts.posts }}</td><th>Medewerkers</th><td>{{ report.counts.staff }}</td><th>EHBO-eenheden</th><td>{{ report.counts.units }}</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Totalen</h2>
        <table class="pairs">
          <tbody>
            <tr><th>Incidenten</th><td>{{ report.totals.incidents }}</td><th>Gem. tot acceptatie</th><td>{{ formatDuration(report.totals.avgResponseSeconds) }}</td></tr>
            <tr><th>Naar alle eenheden</th><td>{{ report.totals.escalated }}</td><th>Langste tot acceptatie</th><td>{{ formatDuration(report.totals.maxResponseSeconds) }}</td></tr>
            <tr><th>Ingetrokken</th><td>{{ report.totals.withdrawn }}</td><th>Gem. aanrijtijd</th><td>{{ formatDuration(report.totals.avgTravelSeconds) }}</td></tr>
          </tbody>
        </table>
        <div class="columns">
          <table v-if="outcomes.length">
            <thead><tr><th>Afloop</th><th class="num">Aantal</th></tr></thead>
            <tbody><tr v-for="[key, n] in outcomes" :key="key"><td>{{ OUTCOMES[key] }}</td><td class="num">{{ n }}</td></tr></tbody>
          </table>
          <table v-if="report.totals.byPost.length">
            <thead><tr><th>Post</th><th class="num">Incidenten</th></tr></thead>
            <tbody><tr v-for="p in report.totals.byPost" :key="p.postName"><td>{{ p.postName }}</td><td class="num">{{ p.count }}</td></tr></tbody>
          </table>
          <table v-if="requests.length">
            <thead><tr><th>Aanvragen</th><th class="num">Aantal</th></tr></thead>
            <tbody><tr v-for="[kind, n] in requests" :key="kind"><td>{{ REQUEST_KINDS[kind].label }}</td><td class="num">{{ n }}</td></tr></tbody>
          </table>
        </div>
      </section>

      <section>
        <h2>Incidenten</h2>
        <table v-if="report.incidents.length" class="incidents">
          <thead>
            <tr><th>Nr</th><th>Post</th><th>Melding</th><th>Gemeld</th><th>Geacc.</th><th>Ter pl.</th><th>Afgerond</th><th>Aanrijtijd</th><th>Eenheid</th><th>Afloop</th><th>Notitie</th></tr>
          </thead>
          <tbody>
            <tr v-for="i in report.incidents" :key="i.number">
              <td class="num">{{ i.number }}</td>
              <td>{{ i.postName }}<template v-if="i.km !== null"> (km {{ formatKm(i.km) }})</template></td>
              <td>{{ i.what ? INCIDENT_WHAT[i.what] : '–' }}{{ i.aed ? ' · AED' : '' }}{{ i.escalated ? ' · alle eenheden' : '' }}</td>
              <td class="mono">{{ clock(i.reportedAt) }}</td>
              <td class="mono">{{ clock(i.acceptedAt) }}</td>
              <td class="mono">{{ clock(i.onSiteAt) }}</td>
              <td class="mono">{{ clock(i.closedAt) }}</td>
              <td class="mono">{{ formatDuration(i.travelSeconds) }}</td>
              <td>{{ i.unitName ?? '–' }}</td>
              <td>{{ i.outcome ? OUTCOMES[i.outcome] : i.status === 'ingetrokken' ? 'Ingetrokken' : 'Open' }}</td>
              <td>{{ i.note ?? '' }}</td>
            </tr>
          </tbody>
        </table>
        <p v-else>Geen incidenten.</p>
      </section>

      <section v-if="report.passages.length">
        <h2>Km-punten per post</h2>
        <table class="incidents">
          <thead><tr><th>Post</th><th>Loop</th><th>Km-punten</th></tr></thead>
          <tbody>
            <template v-for="p in report.passages" :key="p.postName">
              <tr v-for="r in p.runs" :key="r.runName">
                <td>{{ p.postName }}</td>
                <td>{{ r.runName }}</td>
                <td class="mono">{{ r.km.map((km) => formatKm(km)).join(' en ') }}</td>
              </tr>
            </template>
          </tbody>
        </table>
      </section>

      <p class="meta footer">Zonder namen of medische gegevens van slachtoffers. Proefoproepen uit de testmodus tellen niet mee.</p>
    </template>
  </main>
</template>

<style scoped>
.print { max-width: 1000px; margin: 0 auto; padding: 24px 16px; background: #FFFFFF; color: var(--ink); min-height: 100dvh; font-size: 12px; }
.actions { display: flex; gap: 10px; margin-bottom: 18px; }
.actions .btn { width: auto; padding: 0 16px; }
.head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; border-bottom: 2px solid var(--ink); padding-bottom: 10px; }
h1 { font-size: 22px; }
h2 { font-size: 14px; margin: 18px 0 6px; }
.logo { max-height: 60px; max-width: 220px; object-fit: contain; }
.meta { color: var(--muted); font-size: 11px; }
table { border-collapse: collapse; width: 100%; }
th, td { text-align: left; padding: 4px 6px; border-bottom: 1px solid var(--divider); vertical-align: top; }
thead th { font-weight: 700; border-bottom: 1px solid var(--ink); }
.pairs th { font-weight: 600; color: var(--ink-2); width: 1%; white-space: nowrap; }
.columns { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px; margin-top: 10px; }
.num { text-align: right; }
.incidents { font-size: 11px; }
.incidents tr { break-inside: avoid; }
.footer { margin-top: 18px; }
@media print {
  .no-print { display: none !important; }
  .print { padding: 0; max-width: none; }
}
@page { size: A4 landscape; margin: 14mm; }
</style>
