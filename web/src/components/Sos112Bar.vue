<script setup lang="ts">
// Donkere balk met 112, zoals op het poststartscherm en bij het EHBO-verzoek. De app vervangt 112 nooit.
withDefaults(defineProps<{ text?: string }>(), { text: 'Levensgevaar? Bel eerst 112' });
</script>

<template>
  <div class="sos-bar">
    <span class="text"><slot>{{ text }}</slot></span>
    <a href="tel:112" class="call">112</a>
  </div>
</template>

<style scoped>
.sos-bar { display: flex; align-items: center; gap: 12px; padding: 12px 14px; border-radius: 16px; background: var(--primary); color: #FFFFFF; }
.text { flex-grow: 1; font-size: 15px; font-weight: 700; line-height: 1.4; }
.call {
  height: 48px; padding: 0 18px; border-radius: 12px; background: var(--danger); color: #FFFFFF;
  display: flex; align-items: center; font-weight: 700; font-size: 14px; text-decoration: none; -webkit-touch-callout: none;
}
</style>
