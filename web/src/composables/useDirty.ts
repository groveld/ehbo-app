// Is het formulier gewijzigd sinds het laden of het laatste opslaan? Dan pas verschijnt de knop Opslaan.
import { computed, ref } from 'vue';

export function useDirty(form: () => unknown) {
  const snapshot = ref<string | null>(null);
  /** Na het laden en na opslaan: dit is de opgeslagen stand. */
  const markClean = () => { snapshot.value = JSON.stringify(form()); };
  const dirty = computed(() => snapshot.value !== null && JSON.stringify(form()) !== snapshot.value);
  return { dirty, markClean };
}
