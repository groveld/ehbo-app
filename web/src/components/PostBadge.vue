<script setup lang="ts">
// Rondje met het icoon van de soort post (of de letter van een eigen soort); een EHBO-post is een groen vierkant met een kruis.
import { computed } from 'vue';
import type { PostTypeInfo } from '@ehbo/shared';
import { postTypeIcon } from '../icons.ts';
import Icon from './Icon.vue';

const props = withDefaults(defineProps<{ type?: PostTypeInfo; size?: number }>(), { type: undefined, size: 40 });
const ehbo = computed(() => props.type?.key === 'ehbo');
const icon = computed(() => postTypeIcon(props.type?.key));
const fontSize = computed(() => Math.round(props.size * ((props.type?.letter.length ?? 1) > 1 ? 0.32 : 0.4)));
</script>

<template>
  <span
    class="post-badge" :class="{ ehbo }" aria-hidden="true"
    :style="{ width: `${size}px`, height: `${size}px`, background: type?.color ?? '#6B7079', fontSize: `${fontSize}px` }"
  >
    <svg v-if="ehbo" :width="size * 0.45" :height="size * 0.45" viewBox="0 0 18 18" fill="#FFFFFF"><path d="M6 0h6v6h6v6h-6v6H6v-6H0V6h6z" /></svg>
    <Icon v-else-if="icon" :name="icon" :size="Math.round(size * 0.5)" />
    <template v-else>{{ type?.letter }}</template>
  </span>
</template>

<style scoped>
.post-badge { flex-shrink: 0; display: flex; align-items: center; justify-content: center; border-radius: 50%; color: #FFFFFF; font-weight: 700; letter-spacing: -0.02em; }
.post-badge.ehbo { border-radius: 25%; }
</style>
