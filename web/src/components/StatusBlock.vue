<script setup lang="ts">
// Gekleurd kopblok (oproep, verstuurd, onderweg, EHBO-scherm, aanvraag): altijd 140 px hoog, tekst bovenaan, titel 26 px.
defineProps<{ tone: 'red' | 'orange' | 'green' | 'dark' | 'blue'; label: string; title: string; sub?: string }>();
</script>

<template>
  <header class="status-block" :class="tone">
    <div class="texts">
      <span class="label"><slot name="label">{{ label }}</slot></span>
      <h1>{{ title }}</h1>
      <span v-if="sub" class="sub">{{ sub }}</span>
    </div>
    <slot />
  </header>
</template>

<style scoped>
.status-block {
  flex-shrink: 0; display: flex; align-items: flex-start; gap: 16px;
  /* Over de volle breedte van het scherm, ook onder de statusbalk van de telefoon. */
  margin: calc(-1 * env(safe-area-inset-top)) -16px 0; height: calc(140px + env(safe-area-inset-top));
  padding: calc(20px + env(safe-area-inset-top)) 20px 18px;
}
.texts { display: flex; flex-direction: column; gap: 6px; flex-grow: 1; min-width: 0; }
.label { font-size: 13px; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; display: flex; align-items: center; gap: 8px; }
h1 { font-size: 26px; font-weight: 700; line-height: 1.15; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.label { opacity: .8; }
.sub { opacity: .85; font-size: 15px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.red { background: var(--danger); color: #FFFFFF; }
.orange { background: #FFA500; color: var(--ink); }
.green { background: var(--ok); color: #FFFFFF; }
.dark { background: var(--primary); color: #FFFFFF; }
.blue { background: var(--info-icon); color: #FFFFFF; }
</style>
