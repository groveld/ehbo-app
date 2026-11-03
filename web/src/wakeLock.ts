// Keep the screen on while the app is in view (Screen Wake Lock), so a phone in a car holder or lying at a post can be used at once.
// The browser lets go when the app goes to the background; coming back asks again. On by default for staff, per device.
import { ref } from 'vue';
import { load, save } from './storage.ts';

const KEY = 'ehbo.awake';

export const wakeLockSupported = typeof navigator !== 'undefined' && 'wakeLock' in navigator;
/** The switch "Scherm aan houden" on this device. */
export const keepAwake = ref(load<boolean>(KEY) ?? true);
/** Whether the screen is being kept on right now. */
export const awake = ref(false);

let sentinel: WakeLockSentinel | null = null;
let wanted = false;

async function acquire() {
  if (!wanted || !wakeLockSupported || sentinel || document.visibilityState !== 'visible') return;
  try {
    sentinel = await navigator.wakeLock.request('screen');
    awake.value = true;
    sentinel.addEventListener('release', () => {
      sentinel = null;
      awake.value = false;
    });
  } catch {
    // Refused (low battery, or the browser wants a tap first): the next tap or return to the app tries again.
  }
}

function release() {
  void sentinel?.release();
  sentinel = null;
  awake.value = false;
}

/** On while `on` is true and the app is in view. */
export function holdScreen(on: boolean) {
  wanted = on;
  if (on) void acquire();
  else release();
}

export function setKeepAwake(on: boolean) {
  keepAwake.value = on;
  save(KEY, on);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => void acquire());
  document.addEventListener('pointerdown', () => void acquire());
}
