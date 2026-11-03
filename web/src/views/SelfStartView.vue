<script setup lang="ts">
// EHBO: zelf een incident starten, als iemand naar je toe komt. Je bent er al, dus dit gaat meteen door naar afronden.
// De plek: een vaste eenheid haar eigen post; een mobiele eenheid haar GPS (de post als die binnen de straal van thuis ligt), anders de standplaats.
import { computed, onBeforeUnmount, onMounted, reactive, ref } from 'vue';
import { useRouter } from 'vue-router';
import { INCIDENT_PERSONS, INCIDENT_WHAT, RESPONSIVE, placeOf, type IncidentDetails, type LngLat } from '@ehbo/shared';
import Icon from '../components/Icon.vue';
import { useSave } from '../composables/useSave.ts';
import { teamOf } from '../incidents.ts';
import { atLocationM } from '../locations.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';

/** Longer than this and you start with the standplaats: someone is standing in front of you. */
const GPS_TIMEOUT_MS = 4_000;

const store = usePackageStore();
const live = useLiveStore();
const router = useRouter();
const { busy, error, run } = useSave();

const teamId = computed(() => live.myTeamIds[0] ?? null);
const team = computed(() => teamOf(store.pkg, teamId.value));
const locations = computed(() => store.pkg?.locations ?? []);

const form = reactive<IncidentDetails>({ what: null, persons: null, responsive: null, note: null });
const toggle = <K extends keyof IncidentDetails>(key: K, value: IncidentDetails[K]) => { form[key] = form[key] === value ? null : value; };

const gps = ref<LngLat | null>(null);
const locating = ref(false);
/** Chosen by hand; that goes above the GPS. */
const chosen = ref<number | null>(null);

const place = computed(() => (gps.value ? placeOf(locations.value, gps.value, atLocationM(store.pkg)) : null));
/** Without GPS the place of the team: where it stayed, or its own post or standplaats. */
const homeLocationId = computed(() => (teamId.value !== null ? live.teamState(teamId.value)?.stayLocationId : null) ?? team.value?.locationId ?? null);
const locationId = computed(() => chosen.value ?? place.value?.locationId ?? homeLocationId.value);
const placeText = computed(() => {
  if (chosen.value === null && place.value) return place.value.name;
  return locations.value.find((p) => p.id === locationId.value)?.name ?? null;
});

let stopped = false;
onMounted(() => {
  if (team.value?.kind === 'fixed' || !('geolocation' in navigator)) return;
  locating.value = true;
  navigator.geolocation.getCurrentPosition(
    ({ coords }) => { if (!stopped) gps.value = [coords.longitude, coords.latitude]; locating.value = false; },
    () => { locating.value = false; },
    { enableHighAccuracy: true, maximumAge: 30_000, timeout: GPS_TIMEOUT_MS },
  );
});
onBeforeUnmount(() => { stopped = true; });

async function start() {
  if (teamId.value === null || locationId.value === null) return;
  const useGps = chosen.value === null ? gps.value : null;
  let id = 0;
  const ok = await run(async () => { id = await live.selfStart({ teamId: teamId.value!, locationId: locationId.value!, position: useGps, ...form }); });
  if (ok) void router.replace({ name: 'close-incident', params: { id } });
}
</script>

<template>
  <main class="screen tight">
    <header class="page-header">
      <button class="icon-btn" aria-label="Terug" @click="router.back()"><Icon name="back" /></button>
      <div>
        <span class="eyebrow">{{ team ? `EHBO ${team.name}` : '' }}</span>
        <h1>Incident starten</h1>
      </div>
    </header>

    <div class="stack gap-14 fields">
      <div class="form-field">
        <label for="plek" class="q">Waar ben je?</label>
        <p class="card where"><Icon name="pin" :size="18" /><span>{{ placeText ?? (locating ? 'Locatie bepalen…' : 'Kies hieronder een plek') }}</span></p>
        <select id="plek" v-model="chosen" class="input">
          <option :value="null">{{ team?.kind === 'fixed' ? 'Eigen locatie' : 'Automatisch' }}</option>
          <option v-for="p in locations" :key="p.id" :value="p.id">{{ p.name }}</option>
        </select>
      </div>

      <div class="stack gap-8">
        <span class="q">Wat is er aan de hand?</span>
        <div class="choice-grid two">
          <button v-for="(label, key) in INCIDENT_WHAT" :key="key" class="option" :aria-pressed="form.what === key" @click="toggle('what', key)">{{ label }}</button>
        </div>
      </div>

      <div class="persons">
        <span class="q grow">Aantal personen</span>
        <button v-for="n in INCIDENT_PERSONS" :key="n" class="option square" :aria-pressed="form.persons === n" @click="toggle('persons', n)">{{ n }}</button>
      </div>

      <div class="stack gap-8">
        <span class="q">Is de persoon aanspreekbaar?</span>
        <div class="choice-grid">
          <button v-for="(label, key) in RESPONSIVE" :key="key" class="option" :aria-pressed="form.responsive === key" @click="toggle('responsive', key)">{{ label }}</button>
        </div>
        <span class="aed">Bij "nee" wordt de dichtstbijzijnde eenheid met AED opgeroepen. Bel ook 112.</span>
      </div>
    </div>

    <div class="grow" />
    <div class="stack gap-6 footer">
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <button class="btn go" :disabled="busy || locationId === null" @click="start">Incident starten</button>
      <span class="small center">Je bent er al: hierna ga je direct naar afronden.</span>
    </div>
  </main>
</template>

<style scoped>
.fields { padding-top: 4px; }
.q { font-size: 14px; font-weight: 600; }
.where { display: flex; align-items: center; gap: 8px; font-size: 15px; font-weight: 600; }
.persons { display: flex; align-items: center; gap: 8px; }
.square { width: 48px; }
.aed { font-size: 12px; color: var(--warn); line-height: 1.4; }
.footer { padding-top: 12px; }
.center { text-align: center; }
</style>
