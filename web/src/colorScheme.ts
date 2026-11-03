// Light or dark, per device: Zoals de telefoon follows the phone's setting. Sets data-theme on <html>; style.css picks the colours from it.
// index.html does the same before the app loads, so opening it never flashes the other one.
import { computed, ref, watchEffect } from 'vue';
import { load, save } from './storage.ts';

export type Appearance = 'system' | 'light' | 'dark';

export const APPEARANCES: { value: Appearance; label: string }[] = [
  { value: 'system', label: 'Telefoon' },
  { value: 'light', label: 'Licht' },
  { value: 'dark', label: 'Donker' },
];

const KEY = 'app.appearance';
const media = matchMedia('(prefers-color-scheme: dark)');
const systemDark = ref(media.matches);
media.addEventListener('change', (e) => { systemDark.value = e.matches; });

/** The choice in the menu. */
export const appearance = ref<Appearance>(load<Appearance>(KEY) ?? 'system');
/** A page that's always light, such as the report to print. */
export const forceLight = ref(false);
export const dark = computed(() => !forceLight.value && (appearance.value === 'dark' || (appearance.value === 'system' && systemDark.value)));

watchEffect(() => { document.documentElement.dataset.theme = dark.value ? 'dark' : 'light'; });

export function setAppearance(value: Appearance) {
  appearance.value = value;
  save(KEY, value === 'system' ? null : value);
}
