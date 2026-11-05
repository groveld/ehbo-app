<script setup lang="ts">
// Eén post in een lijst: naam, km-punt en contact, met belknop en navigeerknop.
import { computed } from 'vue';
import { telHref, type EventPackage, type PackageLocation } from '@ehbo/shared';
import { navigationUrl } from '../navigate.ts';
import { kmLabel, primaryContact, teamsAt } from '../locations.ts';
import Icon from './Icon.vue';
import LocationBadge from './LocationBadge.vue';

/**
 * alert: er is een open oproep bij deze post (rode rand en badge).
 * late: it should be open by now.
 */
const props = defineProps<{ pkg: EventPackage; location: PackageLocation; alert?: boolean; late?: boolean; quietMinutes?: number | null }>();
const type = computed(() => props.pkg.functionTypes.find((t) => t.id === props.location.typeId));
/** The other functions of this location, small next to the main one (#83). */
const others = computed(() => props.location.functionIds.filter((id) => id !== props.location.typeId).map((id) => props.pkg.functionTypes.find((t) => t.id === id)).filter((t) => t !== undefined));
const contact = computed(() => primaryContact(props.location));
/** km-punt, dan de EHBO-eenheid die hier staat (met kruisje), anders de contactpersoon. */
const teams = computed(() => teamsAt(props.pkg, props.location.id).map((u) => u.name).join(', '));
const who = computed(() => teams.value || contact.value?.name || '');
const km = computed(() => kmLabel(props.location));
</script>

<template>
  <div class="post-row list-row" :class="{ alert }">
    <RouterLink :to="{ name: 'location', params: { id: location.id } }" class="main">
      <LocationBadge :type="type" :size="40" />
      <span class="text">
        <span class="name">{{ location.name }}<span v-if="others.length" class="others"><LocationBadge v-for="t in others" :key="t.id" :type="t" :size="18" /></span></span>
        <span v-if="late" class="late">Nog dicht</span>
        <span v-if="quietMinutes" class="late">{{ quietMinutes }} min niet gezien</span>
        <span v-if="km || who" class="sub">
          {{ km }}<template v-if="km && who"> · </template>
          <span v-if="teams" class="ehbo"><Icon name="ehbo" :size="12" />{{ teams }}</span>
          <template v-else>{{ who }}</template>
        </span>
      </span>
    </RouterLink>
    <a v-if="contact" :href="telHref(contact.phone)" class="round call" :aria-label="`Bel ${location.name}`"><Icon name="phone" :size="20" /></a>
    <a
      v-if="location.lat !== null && location.lng !== null" :href="navigationUrl(location.lat, location.lng, location.name)"
      class="round nav" :aria-label="`Navigeer naar ${location.name}`"
    ><Icon name="navigate" :size="20" /></a>
  </div>
</template>

<style scoped>
.post-row { gap: 10px; padding-right: 12px; }
/* A border inside the frame of the list. */
.post-row.alert { box-shadow: inset 0 0 0 2px var(--danger); border-radius: 16px; }
.post-row .main { flex-direction: row; align-items: center; gap: 12px; color: var(--ink); text-decoration: none; }
.text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.name { font-size: 15px; font-weight: 700; line-height: 1.25; }
.others { display: inline-flex; gap: 3px; margin-left: 6px; vertical-align: -3px; }
.sub { font-size: 13px; color: var(--muted); }
.ehbo { display: inline-flex; align-items: center; gap: 3px; color: var(--ok-text); font-weight: 600; }
.late { align-self: flex-start; font-size: 12px; font-weight: 700; padding: 1px 8px; border-radius: 999px; background: var(--warn-bg); color: var(--warn); }
.round { width: 44px; height: 44px; flex-shrink: 0; border-radius: 50%; display: flex; align-items: center; justify-content: center; -webkit-touch-callout: none; }
.call { background: var(--soft); color: var(--ink); }
.nav { background: var(--primary); color: #FFFFFF; }
</style>
