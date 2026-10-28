// Opslaan met een bezig-status en een foutmelding, voor de beheerformulieren.
import { ref } from 'vue';

export function useSave() {
  const busy = ref(false);
  const error = ref('');

  async function run(action: () => Promise<unknown>): Promise<boolean> {
    busy.value = true;
    error.value = '';
    try {
      await action();
      return true;
    } catch (err) {
      error.value = navigator.onLine ? (err as Error).message : 'Geen bereik. Opslaan kan alleen met internet.';
      return false;
    } finally {
      busy.value = false;
    }
  }

  return { busy, error, run };
}
