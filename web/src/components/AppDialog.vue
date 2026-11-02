<script setup lang="ts">
// The one modal of the app (composables/useDialog.ts). The native <dialog> keeps focus inside and sits on top of everything.
import { nextTick, ref, watch } from 'vue';
import { closeDialog, openDialog } from '../composables/useDialog.ts';

const element = ref<HTMLDialogElement | null>(null);

watch(openDialog, async (dialog) => {
  await nextTick();
  if (dialog && !element.value?.open) element.value?.showModal();
  else if (!dialog) element.value?.close();
});

/** A tap next to the dialog, or Escape, is the same as cancel. */
const dismiss = () => closeDialog(false);
const onClick = (e: MouseEvent) => { if (e.target === element.value) dismiss(); };
</script>

<template>
  <dialog ref="element" class="app-dialog" aria-labelledby="dialog-title" @cancel.prevent="dismiss" @click="onClick">
    <div v-if="openDialog" class="body">
      <h2 id="dialog-title">{{ openDialog.title }}</h2>
      <p v-if="openDialog.text" class="lead">{{ openDialog.text }}</p>
      <p v-if="openDialog.reassure" class="note ok">{{ openDialog.reassure }}</p>
      <div class="actions">
        <button class="btn" :class="openDialog.tone ?? 'primary'" @click="closeDialog(true)">{{ openDialog.confirm }}</button>
        <button v-if="openDialog.cancel" class="btn" @click="closeDialog(false)">{{ openDialog.cancel }}</button>
      </div>
    </div>
  </dialog>
</template>

<style scoped>
.app-dialog {
  width: min(calc(100vw - 32px), 420px); max-height: calc(100dvh - 32px); margin: auto; padding: 0; overflow: auto;
  border: none; border-radius: 20px; background: var(--card); color: var(--ink);
}
.app-dialog::backdrop { background: rgba(22, 24, 29, .55); }
.body { display: flex; flex-direction: column; gap: 12px; padding: 20px; }
h2 { font-size: 20px; font-weight: 700; line-height: 1.25; overflow-wrap: anywhere; }
.note { font-size: 14px; font-weight: 600; }
.actions { display: flex; flex-direction: column; gap: 8px; margin-top: 8px; }
</style>
