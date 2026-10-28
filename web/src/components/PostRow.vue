<script setup lang="ts">
// Eén post in een lijst: naam, km-punt en contact, met belknop en navigeerknop.
import { computed } from 'vue';
import { telHref, type EventPackage, type PackagePost } from '@ehbo/shared';
import { navigationUrl } from '../navigate.ts';
import { postSubtitle, primaryContact } from '../posts.ts';
import Icon from './Icon.vue';
import PostBadge from './PostBadge.vue';

const props = defineProps<{ pkg: EventPackage; post: PackagePost }>();
const type = computed(() => props.pkg.postTypes.find((t) => t.id === props.post.typeId));
const contact = computed(() => primaryContact(props.post));
const subtitle = computed(() => postSubtitle(props.pkg, props.post));
</script>

<template>
  <div class="post-row">
    <RouterLink :to="{ name: 'post', params: { id: post.id } }" class="main">
      <PostBadge :type="type" :size="40" />
      <span class="text">
        <span class="name">{{ post.name }}</span>
        <span v-if="subtitle" class="sub">{{ subtitle }}</span>
      </span>
    </RouterLink>
    <a v-if="contact" :href="telHref(contact.phone)" class="round call" :aria-label="`Bel ${post.name}`"><Icon name="phone" :size="20" /></a>
    <a
      v-if="post.lat !== null && post.lng !== null" :href="navigationUrl(post.lat, post.lng, post.name)"
      class="round nav" :aria-label="`Navigeer naar ${post.name}`"
    ><Icon name="navigate" :size="20" /></a>
  </div>
</template>

<style scoped>
.post-row { display: flex; align-items: center; gap: 10px; padding: 12px 12px 12px 14px; background: var(--card); border-radius: 16px; }
.main { display: flex; align-items: center; gap: 12px; flex-grow: 1; min-width: 0; color: var(--ink); text-decoration: none; }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.name { font-size: 15px; font-weight: 700; line-height: 1.25; }
.sub { font-size: 13px; color: var(--muted); }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; -webkit-touch-callout: none; }
.call { background: var(--soft); color: var(--ink); }
.nav { background: var(--primary); color: #FFFFFF; }
</style>
