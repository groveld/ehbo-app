<script setup lang="ts">
// 1.6 · App-icoon: standaard en eigen logo. Het vierkante logo wordt het icoon op het beginscherm en bij meldingen.
import { computed } from 'vue';
import { ICON_MIN_SIZE, SHORT_NAME_MAX } from '@ehbo/shared';
import AdminPage from '../../components/AdminPage.vue';
import { useSave } from '../../composables/useSave.ts';
import { IMAGE_ACCEPT } from '../../images.ts';
import { useAdminStore } from '../../stores/admin.ts';

const admin = useAdminStore();
const { busy, error, run } = useSave();

const label = computed(() => {
  const event = admin.state?.event;
  return event ? event.style.shortName || event.name.slice(0, SHORT_NAME_MAX) : '';
});
const icon = computed(() => admin.state?.brand.icon ?? '/icons/icon-192.png');
const others = ['Klok', "Foto's", 'Kaart', 'Notities', null, 'Muziek', 'Weer', 'Agenda'];

async function onFile(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (file) await run(() => admin.uploadIcon(file));
}
</script>

<template>
  <AdminPage title="App-icoon" eyebrow="Zo staat de app op het beginscherm" :back="{ name: 'beheer-evenement' }">
    <template #default="{ state }">
      <div class="home" aria-hidden="true">
        <div v-for="(name, i) in others" :key="i" class="app">
          <img v-if="name === null" :src="icon" alt="" class="tile">
          <span v-else class="tile" />
          <span class="app-name" :class="{ ours: name === null }">{{ name ?? label }}</span>
        </div>
      </div>

      <div class="variants">
        <div class="card variant">
          <img src="/icons/icon-512.png" alt="Standaard app-icoon: route met start en finishvlag" width="110" height="110" class="big">
          <strong>Standaard</strong>
          <span class="small">Als er geen eigen vierkant logo is</span>
        </div>
        <div class="card variant">
          <img v-if="state.brand.icon" :src="state.brand.icon" alt="App-icoon met eigen logo" width="110" height="110" class="big">
          <span v-else class="big empty">Nog geen</span>
          <strong>Met eigen logo</strong>
          <span class="small">Het vierkante logo uit Evenement</span>
        </div>
      </div>

      <p class="note">
        De naam onder het icoon is de korte naam van het evenement (max. {{ SHORT_NAME_MAX }} tekens). Upload het vierkante logo als PNG van minstens {{ ICON_MIN_SIZE }} × {{ ICON_MIN_SIZE }} pixels.
      </p>
      <p class="small">Al geïnstalleerd? Android werkt het icoon na een tijdje zelf bij. Op een iPhone moet je de app opnieuw op het beginscherm zetten.</p>
    </template>

    <template #footer>
      <p v-if="error" class="error-text" role="alert">{{ error }}</p>
      <label class="btn primary file" :class="{ disabled: busy }">
        {{ busy ? 'Bezig…' : admin.state?.brand.icon ? 'Ander vierkant logo kiezen' : 'Vierkant logo kiezen' }}
        <input type="file" :accept="IMAGE_ACCEPT" class="visually-hidden" :disabled="busy" @change="onFile">
      </label>
      <button v-if="admin.state?.brand.icon" class="btn" :disabled="busy" @click="run(admin.deleteIcon)">Terug naar het standaardicoon</button>
    </template>
  </AdminPage>
</template>

<style scoped>
.home {
  background: #2A2D35; border-radius: 22px; padding: 22px 16px;
  display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); row-gap: 18px; column-gap: 8px;
}
.app { display: flex; flex-direction: column; align-items: center; gap: 6px; min-width: 0; }
.tile { width: 60px; height: 60px; border-radius: 15px; background: #4A4E58; }
.app-name { font-size: 11px; color: #DCDDE0; max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.app-name.ours { color: #FFFFFF; font-weight: 600; }
.variants { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.variant { display: flex; flex-direction: column; align-items: center; gap: 10px; padding: 16px; border-radius: 18px; text-align: center; font-size: 13px; }
.variant .small { font-size: 12px; }
.big { width: 110px; height: 110px; border-radius: 26px; }
.big.empty { display: flex; align-items: center; justify-content: center; border: 2px dashed var(--line); color: var(--muted); font-size: 13px; }
.file { cursor: pointer; }
.file.disabled { opacity: .45; cursor: default; }
</style>
