<script setup lang="ts">
// The log of an incident or request: a vertical timeline, with the newest step at the bottom and what needs attention in color.
import { clock, type LogEntry } from '../incidents.ts';

defineProps<{ entries: LogEntry[]; title?: string }>();
</script>

<template>
  <section class="activity-log card">
    <h2>{{ title ?? 'Logboek' }}</h2>
    <ol>
      <li v-for="(e, n) in entries" :key="n" :class="e.tone ?? 'done'">
        <span class="dot" />
        <span class="at mono">{{ e.at ? clock(e.at) : '' }}</span>
        <span class="text">{{ e.text }}</span>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.activity-log { margin-top: 12px; }
h2 { font-size: 14px; font-weight: 700; margin-bottom: 10px; }
ol { list-style: none; margin: 0; padding: 0; }
li { position: relative; display: grid; grid-template-columns: 14px 46px minmax(0, 1fr); gap: 8px; padding-bottom: 12px; font-size: 14px; line-height: 1.35; }
li:last-child { padding-bottom: 0; }
/* The line between the dots. */
li:not(:last-child)::before { content: ''; position: absolute; left: 6px; top: 12px; bottom: -3px; width: 2px; background: var(--divider); }
.dot { position: relative; width: 14px; height: 14px; margin-top: 2px; border-radius: 50%; background: var(--ok); box-shadow: 0 0 0 3px var(--card); }
.at { color: var(--muted); font-size: 13px; line-height: 19px; }
.text { min-width: 0; overflow-wrap: anywhere; }
.warn .dot { background: var(--warn-line); }
.warn .text { color: var(--warn); font-weight: 600; }
.stop .dot { background: var(--danger); }
.stop .text { font-weight: 600; }
.waiting .dot { background: var(--card); box-shadow: inset 0 0 0 2px var(--dot), 0 0 0 3px var(--card); }
.waiting .text { color: var(--muted); }
</style>
