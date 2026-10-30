<script setup lang="ts">
// 1.3 · Post invoeren: soort, naam, GPS-positie (de km-punten volgen uit de GPX), aanrijroute, tijden en contactpersonen.
import { computed, reactive, ref, watchEffect } from 'vue';
import { useRouter } from 'vue-router';
import { formatKmList, formatPhone, type ContactData, type PostContactRole, type PostData } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import EventMap from '../../components/EventMap.vue';
import Icon from '../../components/Icon.vue';
import { useGpsFix } from '../../composables/useGpsFix.ts';
import { useDirty } from '../../composables/useDirty.ts';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';
import { usePackageStore } from '../../stores/package.ts';

const props = defineProps<{ id: string }>();
const admin = useAdminStore();
const router = useRouter();
const gps = useGpsFix();
const pkg = usePackageStore();
const picking = ref(false);
const save = useSave();

const isNew = computed(() => props.id === 'nieuw');
const post = computed(() => admin.postById.get(Number(props.id)) ?? null);

const ROLES: { value: PostContactRole; label: string }[] = [
  { value: 'verantwoordelijke', label: 'Verantwoordelijke' },
  { value: 'lid', label: 'Lid' },
  { value: 'reserve', label: 'Reserve' },
];

const form = reactive<PostData>({
  typeId: 0, name: '', lat: null, lng: null, accuracyM: null, address: null, accessRoute: null, timeFrom: null, timeTo: null, contacts: [],
});
const coordsText = ref('');
const showCoords = ref(false);
const loaded = ref(false);
// Een nieuwe post, eenheid of loop is nog niet opgeslagen; een bestaande alleen als er iets gewijzigd is.
const { dirty, markClean } = useDirty(() => form);
const canSave = computed(() => isNew.value || dirty.value);

const emptyContact = (): ContactData => ({ name: '', phone: '', role: form.contacts.length ? 'lid' : 'verantwoordelijke', timeFrom: null, timeTo: null });

watchEffect(() => {
  if (loaded.value || !admin.state) return;
  if (post.value) {
    Object.assign(form, post.value, { contacts: post.value.contacts.map((c) => ({ ...c, phone: formatPhone(c.phone) })) });
  } else {
    form.typeId = admin.state.postTypes[0]?.id ?? 0;
    form.contacts = [emptyContact()];
  }
  markClean();
  loaded.value = true;
});

async function captureGps() {
  const fix = await gps.start();
  if (fix) Object.assign(form, fix);
}

/** "53.14066, 5.81012" zoals Google Maps het kopieert. */
function applyCoords() {
  const m = /(-?\d{1,2}\.\d+)\s*[,;\s]\s*(-?\d{1,3}\.\d+)/.exec(coordsText.value);
  if (!m) {
    save.error.value = 'Plak de coördinaten als "53.14066, 5.81012" (breedte, lengte).';
    return;
  }
  Object.assign(form, { lat: Number(m[1]), lng: Number(m[2]), accuracyM: null });
  save.error.value = '';
  showCoords.value = false;
}

/** "10 km: 2,1, 7,4", per run; they follow from the GPX of the runs and the position of this post. */
const passages = computed(() => (post.value?.passages ?? []).map(({ runId, km }) => {
  const run = admin.state?.runs.find((r) => r.id === runId);
  return `${run?.name ?? 'Loop'}: ${formatKmList(km)}`;
}));

function optionStyle(color: string) {
  return { '--option-color': color, '--option-bg': `${color}1A` };
}

async function submit() {
  const data: PostData = {
    ...form,
    address: form.address || null,
    accessRoute: form.accessRoute || null,
    timeFrom: form.timeFrom || null,
    timeTo: form.timeTo || null,
    // Lege regels (geen nummer) tellen niet mee.
    contacts: form.contacts.filter((c) => c.phone.trim()).map((c) => ({ ...c, timeFrom: c.timeFrom || null, timeTo: c.timeTo || null })),
  };
  if (await save.run(() => admin.savePost(isNew.value ? null : Number(props.id), data))) router.push({ name: 'beheer-posten' });
}

async function remove() {
  if (!confirm(`${form.name} verwijderen? De contactpersonen kunnen zich dan niet meer via deze post aanmelden.`)) return;
  if (await save.run(() => admin.deletePost(Number(props.id)))) router.push({ name: 'beheer-posten' });
}
</script>

<template>
  <AdminPage :title="isNew ? 'Nieuwe post' : form.name || 'Post'" eyebrow="Posten" :back="{ name: 'beheer-posten' }">
    <template #default="{ state }">
      <p v-if="!isNew && !post" class="note warn">Deze post bestaat niet (meer).</p>
      <template v-else>
        <div class="form-field">
          <span class="section-label">Soort post</span>
          <div class="choice-grid">
            <button
              v-for="t in state.postTypes" :key="t.id" class="option" :style="optionStyle(t.color)"
              :aria-pressed="form.typeId === t.id" @click="form.typeId = t.id"
            >{{ t.name }}</button>
          </div>
        </div>

        <div class="form-field">
          <label for="naam">Naam</label>
          <input id="naam" v-model="form.name" class="input" placeholder="Bijv. Waterpost 3 · brug" required>
        </div>

        <div class="form-field">
          <span class="section-label">Locatie</span>
          <button class="btn primary gps" :disabled="gps.measuring.value" @click="captureGps">
            <Icon name="gps" :size="20" />
            {{ gps.measuring.value ? `Meten…${gps.best.value ? ` ± ${gps.best.value.accuracyM} m` : ''}` : 'Huidige GPS-positie vastleggen' }}
          </button>
          <div v-if="form.lat !== null" class="location">
            <span class="mono">{{ form.lat.toFixed(5) }}, {{ form.lng?.toFixed(5) }}</span>
            <span v-if="form.accuracyM !== null" class="tag" :class="form.accuracyM <= 15 ? 'ok' : 'warn'">± {{ form.accuracyM }} m</span>
          </div>
          <span v-else class="small">Nog geen locatie. Leg hem vast als je bij de post staat.</span>
          <p v-if="gps.error.value" class="error-text" role="alert">{{ gps.error.value }}</p>
          <div class="alternatives">
            <button v-if="pkg.pkg" class="add-link" :aria-expanded="picking" @click="picking = !picking">Of: punt op de kaart prikken</button>
            <button v-if="!showCoords" class="add-link" @click="showCoords = true">Of: coördinaten plakken</button>
          </div>
          <div v-if="picking && pkg.pkg" class="pick-map">
            <EventMap
              :pkg="pkg.pkg" picking :focus-post-id="post?.id ?? null"
              :picked="form.lat !== null && form.lng !== null ? [form.lng, form.lat] : null"
              @pick="([lng, lat]) => Object.assign(form, { lat, lng, accuracyM: null })"
            />
          </div>
          <span v-if="picking" class="small">Tik op de plek van de post. Zoom in voor een precieze plek.</span>
          <div v-if="showCoords" class="paste">
            <input v-model="coordsText" class="input" inputmode="decimal" aria-label="Coördinaten" placeholder="53.14066, 5.81012">
            <button class="btn apply" @click="applyCoords">Gebruiken</button>
          </div>
          <label for="adres" class="address-label">Herkenbare plek of adres (optioneel)</label>
          <input id="adres" v-model="form.address" class="input" placeholder="Bijv. Hoofdstraat 12 of bij de brug">
        </div>

        <div class="form-field">
          <span class="section-label">Km-punten</span>
          <span v-for="p in passages" :key="p" class="small">{{ p }}</span>
          <span v-if="!passages.length" class="small">Geen km: geen GPX, geen positie, of de route komt hier niet langs. De km-punten volgen uit de GPX van de lopen.</span>
        </div>

        <div class="row-2">
          <div class="form-field">
            <label for="van">Bemand vanaf</label>
            <input id="van" v-model="form.timeFrom" class="input" type="time">
          </div>
          <div class="form-field">
            <label for="tot">Tot</label>
            <input id="tot" v-model="form.timeTo" class="input" type="time">
          </div>
        </div>

        <div class="form-field">
          <label for="route">Aanrijroute / bijzonderheden</label>
          <textarea id="route" v-model="form.accessRoute" class="input" rows="2" placeholder="Via [weg], hek bij boerderij staat open." />
        </div>

        <section class="stack gap-8">
          <span class="section-label">Contactpersonen</span>
          <div v-for="(c, i) in form.contacts" :key="i" class="card stack gap-8">
            <div class="row-2">
              <input v-model="c.name" class="input" aria-label="Naam contactpersoon" placeholder="Naam">
              <input v-model="c.phone" class="input" type="tel" inputmode="tel" aria-label="Telefoon contactpersoon" placeholder="+31 6 …">
            </div>
            <div class="contact-role">
              <select v-model="c.role" class="input" aria-label="Rol bij de post">
                <option v-for="r in ROLES" :key="r.value" :value="r.value">{{ r.label }}</option>
              </select>
              <button class="icon-btn" aria-label="Contactpersoon verwijderen" @click="form.contacts.splice(i, 1)"><Icon name="trash" :size="20" /></button>
            </div>
          </div>
          <button class="add-link" @click="form.contacts.push(emptyContact())">+ Nog een contact</button>
          <span class="small">Wie hier staat, kan met dit nummer inloggen. De verantwoordelijke zet de post open en dicht.</span>
        </section>
      </template>
    </template>

    <template #footer>
      <p v-if="save.error.value" class="error-text" role="alert">{{ save.error.value }}</p>
      <button v-if="canSave" class="btn primary" :disabled="save.busy.value || !form.name.trim() || (!isNew && !post)" @click="submit">Post opslaan</button>
      <button v-if="!isNew && post" class="btn link danger-link" @click="remove">Post verwijderen</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.gps { border-radius: 12px; }
.location { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.location .tag { margin-left: 0; }
.paste { display: flex; gap: 8px; }
.address-label { margin-top: 10px; }
.alternatives { display: flex; flex-wrap: wrap; column-gap: 18px; }
.pick-map { height: clamp(240px, 40dvh, 440px); }
.apply { width: auto; padding: 0 16px; height: 44px; flex-shrink: 0; }
.contact-role { display: flex; gap: 8px; align-items: center; }
select.input { appearance: auto; }
</style>
