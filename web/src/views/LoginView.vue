<script setup lang="ts">
// 2.3 · Telefoonnummer invullen, en de code van de briefing.
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { normalizePhone } from '@ehbo/shared';
import { ApiRequestError } from '../api.ts';
import Icon from '../components/Icon.vue';
import { useSessionStore } from '../stores/session.ts';

const session = useSessionStore();
const router = useRouter();
const input = ref('');
const code = ref('');
/** Only when the event has a code; without the event (yet) the field is there, the server decides. */
const needsCode = computed(() => session.event?.needsLoginCode ?? true);
const error = ref('');
const codeError = ref('');
const busy = ref(false);

async function submit() {
  error.value = '';
  codeError.value = '';
  // Het veld staat naast "+31": 6 12 34 56 78 is genoeg, maar 06… en +31… werken ook.
  const phone = normalizePhone(input.value);
  if (!phone) {
    error.value = 'Dit is geen geldig telefoonnummer.';
    return;
  }
  busy.value = true;
  try {
    const result = await session.login(phone, needsCode.value ? code.value.replace(/\s/g, '') : '');
    await router.push({ name: result === 'ok' ? 'recognized' : 'unknown' });
  } catch (err) {
    if (err instanceof ApiRequestError && err.status === 403) {
      codeError.value = err.message;
      return;
    }
    error.value = navigator.onLine ? (err as Error).message : 'Geen bereik. Aanmelden lukt alleen met internet; probeer het zo opnieuw.';
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <main class="screen">
    <div class="stack gap-18 top">
      <RouterLink :to="{ name: 'participant' }" aria-label="Terug" class="icon-btn back"><Icon name="back" /></RouterLink>
      <div class="stack gap-6 intro">
        <span class="eyebrow">Medewerker / vrijwilliger</span>
        <h1 class="title">Aanmelden</h1>
        <p class="lead">Vul het telefoonnummer in waarmee je bij de organisatie bekend bent<template v-if="needsCode">, en de code die je op de briefing hoort</template>. De app zoekt dan zelf je functie en locatie op.</p>
      </div>
    </div>

    <form class="stack gap-8 form" @submit.prevent="submit">
      <label for="tel" class="label">Je mobiele nummer</label>
      <div class="field" :class="{ invalid: error }">
        <span class="prefix">+31</span>
        <input
          id="tel" v-model="input" type="tel" inputmode="tel" autocomplete="tel" placeholder="6 12 34 56 78"
          :aria-invalid="Boolean(error)" aria-describedby="tel-hint"
        >
      </div>
      <span v-if="error" id="tel-hint" class="error" role="alert">{{ error }}</span>
      <span v-else id="tel-hint" class="small">Ook 06-nummer zonder +31 werkt.</span>
      <template v-if="needsCode">
        <label for="code" class="label code-label">Code van de briefing</label>
        <div class="field code" :class="{ invalid: codeError }">
          <input
            id="code" v-model="code" type="text" inputmode="numeric" pattern="[0-9]*" autocomplete="off" maxlength="12"
            :aria-invalid="Boolean(codeError)" aria-describedby="code-hint"
          >
        </div>
        <span v-if="codeError" id="code-hint" class="error" role="alert">{{ codeError }}</span>
        <span v-else id="code-hint" class="small">Weet je hem niet? Vraag het de coördinator.</span>
      </template>
      <button class="btn primary submit" :disabled="busy || !input.trim() || (needsCode && !code.trim())">{{ busy ? 'Even zoeken…' : 'Verder' }}</button>
    </form>

    <div class="grow" />
    <div class="note">
      <Icon name="info" :size="18" />
      <span>Je blijft aangemeld tot het einde van het evenement, ook als je even geen bereik hebt.</span>
    </div>
  </main>
</template>

<style scoped>
.top { padding-top: 14px; }
.back { margin-left: -12px; }
.intro { padding-top: 16px; }
.form { padding-top: 36px; }
.label { font-size: 14px; font-weight: 600; }
.field { display: flex; height: 58px; border-radius: 14px; border: 2px solid var(--ink); background: var(--card); overflow: hidden; }
.field.invalid { border-color: var(--danger); }
.prefix { display: flex; align-items: center; padding: 0 14px; font-size: 17px; color: var(--muted); border-right: 1px solid var(--line); }
input { flex-grow: 1; min-width: 0; border: none; padding: 0 14px; font: 500 20px var(--mono); background: transparent; color: var(--ink); outline: none; }
.code-label { margin-top: 14px; }
.field.code { width: 140px; }
.field.code input { text-align: center; letter-spacing: .1em; }
.error { font-size: 13px; font-weight: 600; color: var(--danger); }
.submit { margin-top: 14px; }
</style>
