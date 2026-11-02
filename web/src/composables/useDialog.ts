// Our own dialogs instead of the browser's confirm(): same look as the app, and room to explain. Shown by AppDialog.vue in App.vue.
import { shallowRef } from 'vue';

export interface DialogOptions {
  title: string;
  text?: string;
  /** Reassurance in a green box, such as "you can undo this". */
  reassure?: string;
  confirm: string;
  /** Without it the dialog only informs, with one button. */
  cancel?: string;
  /** danger for what takes something away; otherwise the primary color. */
  tone?: 'danger' | 'primary';
}

interface OpenDialog extends DialogOptions {
  resolve: (confirmed: boolean) => void;
}

/** What's on screen now; the next one waits its turn. */
export const openDialog = shallowRef<OpenDialog | null>(null);
const waiting: OpenDialog[] = [];

export function closeDialog(confirmed: boolean) {
  openDialog.value?.resolve(confirmed);
  openDialog.value = waiting.shift() ?? null;
}

function show(options: DialogOptions) {
  return new Promise<boolean>((resolve) => {
    const dialog = { ...options, resolve };
    if (openDialog.value) waiting.push(dialog);
    else openDialog.value = dialog;
  });
}

/** Asks first; true when confirmed. */
export const confirmDialog = (options: DialogOptions) => show({ cancel: 'Annuleren', ...options });

/** Tells something that needs attention. */
export const messageDialog = (options: Omit<DialogOptions, 'cancel'>) => show(options);

/** Closing a post, from the post screen and the post details. People hold back when they don't know it can be undone. */
export const confirmClosePost = (name: string) => confirmDialog({
  title: `${name} sluiten?`,
  text: 'Zolang de post dicht is, kan hij geen verzoeken doen en staat hij grijs op de kaart.',
  reassure: 'Je kunt de post daarna altijd weer openen met de knop Post openen.',
  confirm: 'Post sluiten',
  cancel: 'Open laten',
  tone: 'danger',
});
