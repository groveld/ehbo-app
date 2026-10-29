<script setup lang="ts">
// Eén post in een lijst: naam, km-punt en contact, met belknop en navigeerknop.
import { computed } from 'vue';
import { telHref, type EventPackage, type PackagePost } from '@ehbo/shared';
import { navigationUrl } from '../navigate.ts';
import { kmLabel, primaryContact, unitsAt } from '../posts.ts';
import Icon from './Icon.vue';
import PostBadge from './PostBadge.vue';

/** alert: er is een open oproep bij deze post (rode rand en badge). */
const props = defineProps<{ pkg: EventPackage; post: PackagePost; alert?: boolean }>();
const type = computed(() => props.pkg.postTypes.find((t) => t.id === props.post.typeId));
const contact = computed(() => primaryContact(props.post));
/** km-punt, dan de EHBO-eenheid die hier staat (met kruisje), anders de contactpersoon. */
const units = computed(() => unitsAt(props.pkg, props.post.id).map((u) => u.name).join(', '));
const who = computed(() => units.value || contact.value?.name || '');
const km = computed(() => kmLabel(props.post.km));
</script>

<template>
  <div class="post-row" :class="{ alert }">
    <RouterLink :to="{ name: 'post', params: { id: post.id } }" class="main">
      <PostBadge :type="type" :size="40" />
      <span class="text">
        <span class="name">{{ post.name }}</span>
        <span v-if="km || who" class="sub">
          {{ km }}<template v-if="km && who"> · </template>
          <span v-if="units" class="ehbo"><Icon name="ehbo" :size="12" />{{ units }}</span>
          <template v-else>{{ who }}</template>
        </span>
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
.post-row.alert { border: 2px solid var(--danger); padding: 10px 10px 10px 12px; }
.main { display: flex; align-items: center; gap: 12px; flex-grow: 1; min-width: 0; color: var(--ink); text-decoration: none; }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.name { font-size: 15px; font-weight: 700; line-height: 1.25; }
.sub { font-size: 13px; color: var(--muted); }
.ehbo { display: inline-flex; align-items: center; gap: 3px; color: var(--ok-text); font-weight: 600; }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; -webkit-touch-callout: none; }
.call { background: var(--soft); color: var(--ink); }
.nav { background: var(--primary); color: #FFFFFF; }
</style>
