<script setup lang="ts">
// Beheer › Importeren en exporteren (#43): prepare the event in a spreadsheet. The export is also the template.
// Importing checks first and shows what would change; only "Importeren" saves, all or nothing.
import { computed, ref } from 'vue';
import type { AdminState, ImportPreview, ImportRequest } from '@ehbo/shared';
import { api } from '../../api.ts';
import AdminPage from '../../components/AdminPage.vue';
import Icon from '../../components/Icon.vue';
import { confirmDialog } from '../../composables/useDialog.ts';
import { useSave } from '../../composables/useSave.ts';
import { useAdminStore } from '../../stores/admin.ts';

const SHEETS = ['locaties', 'contactpersonen', 'ehbo-eenheden', 'ehbo-leden', 'kernteam', 'noodnummers'];

const admin = useAdminStore();
const files = ref<ImportRequest['files']>([]);
const removeMissing = ref(false);
const preview = ref<ImportPreview | null>(null);
const done = ref(false);
const { busy, error, run } = useSave();

const ready = computed(() => preview.value !== null && !preview.value.problems.length && preview.value.sheets.some((s) => s.added || s.changed || s.removed));
const removing = computed(() => preview.value?.sheets.reduce((n, s) => n + s.removed, 0) ?? 0);

async function base64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

async function check() {
  done.value = false;
  if (!files.value.length) {
    preview.value = null;
    return;
  }
  await run(async () => {
    preview.value = await api<ImportPreview>('/api/admin/import/check', { method: 'POST', body: { files: files.value, removeMissing: removeMissing.value } });
  });
}

async function choose(e: Event) {
  const input = e.target as HTMLInputElement;
  files.value = await Promise.all([...(input.files ?? [])].map(async (f) => ({ name: f.name, data: await base64(f) })));
  input.value = '';
  await check();
}

async function importNow() {
  if (removing.value && !await confirmDialog({
    title: `${removing.value} ${removing.value === 1 ? 'onderdeel' : 'onderdelen'} verwijderen?`,
    text: 'Wat niet in het bestand staat, gaat weg: locaties, eenheden, kernteamfuncties en noodnummers.',
    confirm: 'Importeren en verwijderen',
    tone: 'danger',
  })) return;
  if (await run(async () => {
    admin.state = await api<AdminState>('/api/admin/import', { method: 'POST', body: { files: files.value, removeMissing: removeMissing.value } });
  })) {
    done.value = true;
    preview.value = null;
    files.value = [];
  }
}
</script>

<template>
  <AdminPage title="Importeren en exporteren" eyebrow="Beheer" :back="{ name: 'admin' }">
    <section class="stack gap-8">
      <span class="section-title">Exporteren</span>
      <a href="/api/admin/export.xlsx" class="btn primary" download><Icon name="download" :size="20" />Excel-bestand downloaden</a>
      <span class="small">Met alles wat er nu staat, en met keuzelijsten. Vul het aan en importeer het weer: het is ook het sjabloon.</span>
      <details class="csv">
        <summary>Of per tabblad als CSV</summary>
        <div class="csv-links">
          <a v-for="s in SHEETS" :key="s" :href="`/api/admin/export/${s}.csv`" download>{{ s }}.csv</a>
        </div>
      </details>
    </section>

    <section class="stack gap-8">
      <span class="section-title">Importeren</span>
      <label class="btn file">
        <Icon name="share" :size="20" />{{ files.length ? files.map((f) => f.name).join(', ') : 'Bestand kiezen (.xlsx of .csv)' }}
        <input type="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" multiple class="visually-hidden" @change="choose">
      </label>
      <label class="card remove">
        <input v-model="removeMissing" type="checkbox" @change="check">
        <span class="stack"><strong>Ontbrekende onderdelen verwijderen</strong><span class="small">Wat niet in het bestand staat, gaat weg. Anders blijft het staan.</span></span>
      </label>
      <span class="small">Er wordt pas iets opgeslagen als je op Importeren tikt, en dan alles in één keer of niets. Locaties, eenheden en functies worden op naam herkend.</span>
    </section>

    <p v-if="done" class="note ok" role="status">Geïmporteerd. Telefoons halen de nieuwe gegevens vanzelf op.</p>

    <template v-if="preview">
      <section class="stack gap-6">
        <span class="section-title">Wat er verandert</span>
        <div class="list">
          <div v-for="s in preview.sheets" :key="s.sheet" class="list-row sheet">
            <strong class="grow">{{ s.sheet }}</strong>
            <span class="small">{{ s.added }} nieuw · {{ s.changed }} gewijzigd · {{ s.unchanged }} gelijk<template v-if="preview.removeMissing"> · {{ s.removed }} weg</template></span>
          </div>
        </div>
      </section>
      <section v-if="preview.problems.length" class="stack gap-6">
        <span class="section-title">Eerst verbeteren ({{ preview.problems.length }})</span>
        <div class="list">
          <div v-for="(p, i) in preview.problems" :key="i" class="list-row problem">
            <span class="small where">{{ p.sheet }}<template v-if="p.row"> · regel {{ p.row }}</template></span>
            <span>{{ p.message }}</span>
          </div>
        </div>
      </section>
      <p v-else-if="!ready" class="note">Het bestand is hetzelfde als wat er nu staat.</p>
    </template>
    <p v-if="error" class="error-text" role="alert">{{ error }}</p>

    <template v-if="ready" #footer>
      <button class="btn primary" :disabled="busy" @click="importNow">Importeren</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.btn.file { position: relative; justify-content: flex-start; gap: 10px; padding: 0 16px; text-align: left; cursor: pointer; }
.remove { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
.remove input { width: 22px; height: 22px; margin-top: 2px; flex-shrink: 0; }
.csv summary { min-height: 44px; display: flex; align-items: center; font-size: 14px; font-weight: 600; cursor: pointer; }
.csv-links { display: flex; flex-wrap: wrap; gap: 8px 16px; padding: 4px 0 8px; font-size: 14px; }
.sheet { min-height: 48px; gap: 12px; flex-wrap: wrap; }
.problem { flex-direction: column; align-items: flex-start; gap: 2px; padding-top: 10px; padding-bottom: 10px; font-size: 14px; }
.where { color: var(--warn); font-weight: 600; }
</style>
