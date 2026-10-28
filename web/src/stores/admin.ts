// Beheer: de volledige stand van het evenement. Elke wijziging stuurt de nieuwe stand terug.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { AddAdminRequest, AdminState, CoreTeamEntry, EmergencyNumber, EventSettings, LogoUpload, PostData, Report, RunData, UnitData } from '@ehbo/shared';
import { api, ApiRequestError } from '../api.ts';
import { makeIconSet, makeLogo } from '../images.ts';
import { useSessionStore } from './session.ts';

export const useAdminStore = defineStore('admin', () => {
  const state = ref<AdminState | null>(null);
  const loading = ref(false);

  const postTypeById = computed(() => new Map(state.value?.postTypes.map((t) => [t.id, t]) ?? []));
  const postById = computed(() => new Map(state.value?.posts.map((p) => [p.id, p]) ?? []));

  async function load() {
    loading.value = true;
    try {
      state.value = await api<AdminState>('/api/admin');
    } finally {
      loading.value = false;
    }
  }

  /** Voert een wijziging uit en neemt de nieuwe stand over. */
  async function change(path: string, method: 'POST' | 'PUT' | 'DELETE', body?: object) {
    state.value = await api<AdminState>(path, { method, body });
  }

  /** Naam, kleuren of logo's gewijzigd: ook de openbare gegevens (stijl van de app zelf) bijwerken. */
  async function changeStyle(path: string, method: 'PUT' | 'DELETE', body?: object) {
    await change(path, method, body);
    await useSessionStore().loadEvent();
  }

  async function uploadGpx(runId: number, file: File) {
    const res = await fetch(`/api/admin/runs/${runId}/gpx?filename=${encodeURIComponent(file.name)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/gpx+xml' },
      body: await file.text(),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiRequestError(res.status, body);
    state.value = body as AdminState;
  }

  return {
    state, loading, postTypeById, postById, load, uploadGpx,
    uploadLogo: async (file: File) => changeStyle('/api/admin/brand/logo', 'PUT', { png: await makeLogo(file) } satisfies LogoUpload),
    uploadIcon: async (file: File) => changeStyle('/api/admin/brand/icon', 'PUT', await makeIconSet(file)),
    deleteLogo: () => changeStyle('/api/admin/brand/logo', 'DELETE'),
    deleteIcon: () => changeStyle('/api/admin/brand/icon', 'DELETE'),
    saveEvent: (e: EventSettings) => changeStyle('/api/admin/event', 'PUT', e),
    saveRun: (id: number | null, r: RunData) => change(id === null ? '/api/admin/runs' : `/api/admin/runs/${id}`, id === null ? 'POST' : 'PUT', r),
    deleteRun: (id: number) => change(`/api/admin/runs/${id}`, 'DELETE'),
    savePost: (id: number | null, p: PostData) => change(id === null ? '/api/admin/posts' : `/api/admin/posts/${id}`, id === null ? 'POST' : 'PUT', p),
    deletePost: (id: number) => change(`/api/admin/posts/${id}`, 'DELETE'),
    saveUnit: (id: number | null, u: UnitData) => change(id === null ? '/api/admin/units' : `/api/admin/units/${id}`, id === null ? 'POST' : 'PUT', u),
    deleteUnit: (id: number) => change(`/api/admin/units/${id}`, 'DELETE'),
    saveCoreTeam: (entries: CoreTeamEntry[]) => change('/api/admin/core-team', 'PUT', entries),
    saveEmergencyNumbers: (numbers: EmergencyNumber[]) => change('/api/admin/emergency-numbers', 'PUT', numbers),
    addAdmin: (request: AddAdminRequest) => change('/api/admin/admins', 'POST', request),
    removeAdmin: (phone: string) => change(`/api/admin/admins/${encodeURIComponent(phone)}`, 'DELETE'),
    // Rapport en testmodus. De testmodus verandert ook de live stand (banner op alle telefoons).
    loadReport: () => api<Report>('/api/admin/report'),
    setTestMode: (on: boolean) => change('/api/admin/test-mode', 'PUT', { on }),
    deleteTestData: () => change('/api/admin/test-data', 'DELETE'),
  };
});
