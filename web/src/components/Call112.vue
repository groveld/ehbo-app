<script setup lang="ts">
// 112 staat altijd onderaan, op dezelfde plek. De app vervangt 112 nooit.
import Icon from './Icon.vue';
</script>

<template>
  <a href="tel:112" class="btn danger sos"><Icon name="phone" :size="20" />Noodgeval: bel 112</a>
</template>
