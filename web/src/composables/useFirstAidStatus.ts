// What participants learn without a live connection (GET /api/first-aid-status): which standplaatsen are empty, and whether
// the event is open, which decides Bel EHBO. One poll every half minute while a participant screen is in view, shared by every
// component that asks; without signal the last answer stays, also after a restart.
import { onBeforeUnmount, onMounted, ref } from 'vue';
import type { FirstAidStatus } from '@ehbo/shared';
import { api } from '../api.ts';
import { useLiveStore } from '../stores/live.ts';
import { load, save } from '../storage.ts';

const OPEN_KEY = 'app.event-open';
const awayLocationIds = ref<number[]>([]);
const open = ref(load<boolean>(OPEN_KEY) ?? false);
let users = 0;
let timer: ReturnType<typeof setInterval> | undefined;

async function refresh() {
  if (document.visibilityState !== 'visible') return;
  try {
    const status = await api<FirstAidStatus>('/api/first-aid-status');
    awayLocationIds.value = status.awayLocationIds;
    open.value = status.open;
    save(OPEN_KEY, status.open);
    // Participants have no live connection, so changes in admin reach them this way.
    useLiveStore().checkData(status.dataVersion);
  } catch {
    // Geen bereik.
  }
}

export function useFirstAidStatus() {
  onMounted(() => {
    if (users++) return;
    void refresh();
    timer = setInterval(refresh, 30_000);
    document.addEventListener('visibilitychange', refresh);
  });
  onBeforeUnmount(() => {
    if (--users) return;
    clearInterval(timer);
    document.removeEventListener('visibilitychange', refresh);
  });
  return { awayLocationIds, open };
}
