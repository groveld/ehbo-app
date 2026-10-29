<script setup lang="ts">
// Kaart met parcours en posten. Tegels, lettertypen en iconen komen van de eigen server (en staan offline in de cache).
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { layers, namedFlavor } from '@protomaps/basemaps';
// MapLibre laadt zijn worker als los bestand; Vite ziet dat adres niet vanzelf, dus geven we het mee.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Bbox, EventPackage, LngLat, PackagePost } from '@ehbo/shared';
import type { Ambulance } from '../posts.ts';
import { assetUrl, tileUrl } from '../stores/package.ts';

maplibregl.setWorkerUrl(workerUrl);

const props = withDefaults(defineProps<{
  pkg: EventPackage;
  /** Welke posten op de kaart; standaard alle posten met een locatie. */
  posts?: PackagePost[];
  /** Ingezoomd op deze post. */
  focusPostId?: number | null;
  /** Deze loop dik en donker, de rest lichter. */
  highlightRunId?: number | null;
  showUser?: boolean;
  /** Beheer: tik op de kaart om een punt te kiezen. */
  picking?: boolean;
  picked?: LngLat | null;
  interactive?: boolean;
  /** Posten met een open oproep: rood, met een gloed. */
  alertPostIds?: number[];
  /** Dichte posten: grijs. */
  closedPostIds?: number[];
  /** Mobiele EHBO-eenheden in dienst, op hun laatste GPS-positie; busy = bezig met een oproep. */
  ambulances?: Ambulance[];
}>(), { posts: undefined, focusPostId: null, highlightRunId: null, showUser: true, picking: false, picked: null, interactive: true, alertPostIds: () => [], closedPostIds: () => [], ambulances: () => [] });

const emit = defineEmits<{ select: [postId: number]; pick: [lngLat: LngLat] }>();

const container = ref<HTMLDivElement>();
let map: maplibregl.Map | null = null;
let markers: maplibregl.Marker[] = [];
let ambulanceMarkers: maplibregl.Marker[] = [];
let userMarker: maplibregl.Marker | null = null;
let pickedMarker: maplibregl.Marker | null = null;
let watchId: number | null = null;

const CROSS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>';
const AMBULANCE = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 10H6"/><path d="M8 8v4"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.3a1 1 0 0 0-.7-.9l-1.9-.7a1 1 0 0 1-.6-.5l-1.5-3a1 1 0 0 0-.9-.6H14"/><path d="M9 18h6"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';

function style(): StyleSpecification {
  const m = props.pkg.map;
  const background = { id: 'achtergrond', type: 'background', paint: { 'background-color': '#ECE9E1' } } as const;
  if (!m) return { version: 8, sources: {}, layers: [background] };
  return {
    version: 8,
    glyphs: assetUrl(m, 'fonts/{fontstack}/{range}.pbf'),
    sprite: assetUrl(m, 'sprites/v4/light'),
    sources: {
      protomaps: { type: 'vector', tiles: [tileUrl(m)], maxzoom: m.maxZoom, bounds: m.bbox, attribution: '© OpenStreetMap · Protomaps' },
    },
    layers: layers('protomaps', namedFlavor('light'), { lang: 'nl' }),
  };
}

function runFeatures() {
  return {
    type: 'FeatureCollection' as const,
    features: props.pkg.runs.filter((r) => r.line).map((r) => ({
      type: 'Feature' as const,
      properties: { highlight: props.highlightRunId === null || props.highlightRunId === r.id },
      geometry: { type: 'LineString' as const, coordinates: r.line! },
    })),
  };
}

function markerElement(post: PackagePost) {
  const type = props.pkg.postTypes.find((t) => t.id === post.typeId);
  const el = document.createElement('button');
  el.type = 'button';
  const alert = props.alertPostIds.includes(post.id);
  el.className = `post-marker${type?.key === 'ehbo' ? ' ehbo' : ''}${post.id === props.focusPostId ? ' focus' : ''}${alert ? ' alert' : ''}`;
  el.style.background = alert ? '#C8261E' : props.closedPostIds.includes(post.id) ? '#A8A59C' : (type?.color ?? '#6B7079');
  el.setAttribute('aria-label', post.name);
  if (type?.key === 'ehbo') el.innerHTML = CROSS;
  else {
    el.textContent = type?.letter ?? '';
    if ((type?.letter.length ?? 0) > 1) el.classList.add('small');
    // Een EHBO-eenheid heeft hier haar standplaats: klein groen kruisje op de rand.
    if (props.pkg.units.some((u) => u.postId === post.id)) el.insertAdjacentHTML('beforeend', `<span class="ehbo-dot">${CROSS}</span>`);
  }
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    emit('select', post.id);
  });
  return el;
}

function drawPosts() {
  if (!map) return;
  for (const m of markers) m.remove();
  const posts = (props.posts ?? props.pkg.posts).filter((p) => p.lat !== null && p.lng !== null);
  markers = posts.map((p) => new maplibregl.Marker({ element: markerElement(p) }).setLngLat([p.lng!, p.lat!]).addTo(map!));
}

/** Mobiele EHBO als ambulance: groen in dienst, rood als ze met een oproep bezig is. */
function drawAmbulances() {
  if (!map) return;
  for (const m of ambulanceMarkers) m.remove();
  ambulanceMarkers = props.ambulances.map((a) => {
    const el = document.createElement('div');
    el.className = `unit-marker${a.busy ? ' busy' : ''}`;
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `EHBO ${a.name}${a.busy ? ', bezig met een oproep' : ''}`);
    el.innerHTML = AMBULANCE;
    return new maplibregl.Marker({ element: el }).setLngLat([a.lng, a.lat]).addTo(map!);
  });
}

function drawPicked() {
  if (!map) return;
  pickedMarker?.remove();
  pickedMarker = props.picked ? new maplibregl.Marker({ color: '#C8261E' }).setLngLat(props.picked).addTo(map) : null;
}

/** Het hele gebied in beeld, of ingezoomd op één post. */
function frame() {
  if (!map) return;
  const focus = props.focusPostId !== null ? props.pkg.posts.find((p) => p.id === props.focusPostId) : undefined;
  if (focus?.lat != null && focus.lng != null) {
    map.jumpTo({ center: [focus.lng, focus.lat], zoom: 15 });
    return;
  }
  const points: LngLat[] = [
    ...props.pkg.runs.flatMap((r) => r.line ?? []),
    ...props.pkg.posts.filter((p) => p.lat !== null && p.lng !== null).map((p) => [p.lng!, p.lat!] as LngLat),
  ];
  const bounds = points.length ? points.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(points[0], points[0])) : null;
  if (bounds) map.fitBounds(bounds, { padding: 32, maxZoom: 16, duration: 0 });
  else if (props.pkg.map) map.fitBounds(props.pkg.map.bbox as Bbox, { duration: 0 });
}

/** Eigen positie als blauwe stip, maar alleen als de app al toestemming heeft (niet ongevraagd vragen). */
async function startUserLocation() {
  if (!props.showUser || !('geolocation' in navigator) || !navigator.permissions) return;
  try {
    if ((await navigator.permissions.query({ name: 'geolocation' })).state !== 'granted') return;
  } catch {
    return;
  }
  const el = document.createElement('div');
  el.className = 'user-dot';
  watchId = navigator.geolocation.watchPosition(({ coords }) => {
    if (!map) return;
    userMarker ??= new maplibregl.Marker({ element: el }).setLngLat([coords.longitude, coords.latitude]).addTo(map);
    userMarker.setLngLat([coords.longitude, coords.latitude]);
  }, () => {}, { enableHighAccuracy: true, maximumAge: 10_000 });
}

onMounted(() => {
  map = new maplibregl.Map({
    container: container.value!,
    style: style(),
    attributionControl: { compact: true },
    interactive: props.interactive,
    maxZoom: 18,
    pitchWithRotate: false,
    dragRotate: false,
  });
  map.touchZoomRotate.disableRotation();
  map.on('load', () => {
    // De bronvermelding begint ingeklapt (alleen het ⓘ-knopje), zodat hij de kaart niet bedekt.
    container.value?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    map!.addSource('lopen', { type: 'geojson', data: runFeatures() });
    map!.addLayer({
      id: 'lopen',
      type: 'line',
      source: 'lopen',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['case', ['get', 'highlight'], '#16181D', '#9A9CA3'],
        'line-width': ['case', ['get', 'highlight'], 4, 3],
      },
    });
  });
  map.on('click', (e) => {
    if (props.picking) emit('pick', [Math.round(e.lngLat.lng * 1e6) / 1e6, Math.round(e.lngLat.lat * 1e6) / 1e6]);
  });
  drawPosts();
  drawAmbulances();
  drawPicked();
  frame();
  void startUserLocation();
});

watch(() => [props.posts, props.pkg, props.focusPostId, props.alertPostIds, props.closedPostIds], drawPosts);
watch(() => props.picked, drawPicked);
watch(() => props.ambulances, drawAmbulances);
// Naar een andere post (bijv. vanaf de postpagina): de kaart gaat mee.
watch(() => props.focusPostId, frame);
watch(() => [props.highlightRunId, props.pkg], () => (map?.getSource('lopen') as GeoJSONSource | undefined)?.setData(runFeatures()));

onBeforeUnmount(() => {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  map?.remove();
  map = null;
});
</script>

<template>
  <div ref="container" class="event-map" :class="{ picking }" />
</template>

<style scoped>
.event-map { width: 100%; height: 100%; border-radius: 18px; overflow: hidden; background: #ECE9E1; }
.event-map.picking :deep(.maplibregl-canvas) { cursor: crosshair; }
.event-map :deep(.post-marker) {
  width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 2px solid #FFFFFF; box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
  color: #FFFFFF; font: 700 12px var(--sans); display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.event-map :deep(.post-marker.small) { font-size: 9px; letter-spacing: -0.02em; }
.event-map :deep(.post-marker.ehbo) { border-radius: 8px; }
.event-map :deep(.post-marker) { position: relative; }
.event-map :deep(.ehbo-dot) {
  position: absolute; right: -6px; bottom: -6px; width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid #FFFFFF;
  background: #0A7D4F; display: flex; align-items: center; justify-content: center;
}
.event-map :deep(.ehbo-dot svg) { width: 10px; height: 10px; }
.event-map :deep(.unit-marker) {
  width: 32px; height: 32px; border-radius: 50%; background: #FFFFFF; border: 2.5px solid #0A7D4F; color: #0A7D4F;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
}
.event-map :deep(.unit-marker.busy) { border-color: #C8261E; color: #C8261E; }
.event-map :deep(.post-marker.alert) { width: 32px; height: 32px; box-shadow: 0 0 0 10px rgba(200, 38, 30, .2); z-index: 1; }
.event-map :deep(.post-marker.focus) { width: 36px; height: 36px; box-shadow: 0 0 0 8px rgba(31, 111, 178, .25); }
.event-map :deep(.user-dot) {
  width: 16px; height: 16px; border-radius: 50%; background: #1F6FB2; border: 3px solid #FFFFFF; box-shadow: 0 0 0 6px rgba(31, 111, 178, .25);
}
</style>
