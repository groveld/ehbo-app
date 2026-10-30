<script setup lang="ts">
// Kaart met parcours en posten. Tegels, lettertypen en iconen komen van de eigen server (en staan offline in de cache).
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LIGHT, layers, type Flavor } from '@protomaps/basemaps';
// MapLibre laadt zijn worker als los bestand; Vite ziet dat adres niet vanzelf, dus geven we het mee.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { Bbox, EventPackage, LngLat, PackagePost } from '@ehbo/shared';
import { iconSvg, postTypeIcon } from '../icons.ts';
import { isOnRun, type Ambulance } from '../posts.ts';
import { assetUrl, tileUrl } from '../stores/package.ts';

maplibregl.setWorkerUrl(workerUrl);

const props = withDefaults(defineProps<{
  pkg: EventPackage;
  /** Welke posten op de kaart; standaard alle posten met een locatie. */
  posts?: PackagePost[];
  /** Ingezoomd op deze post. */
  focusPostId?: number | null;
  /** Deze loop dik en donker en in beeld; wat er niet aan ligt wordt bijna doorzichtig. */
  highlightRunId?: number | null;
  showUser?: boolean;
  /** Beheer: tik op de kaart om een punt te kiezen. */
  picking?: boolean;
  picked?: LngLat | null;
  interactive?: boolean;
  /** Posten met een open oproep: rood, met een gloed. */
  alertPostIds?: number[];
  /** Mobiele EHBO-eenheden onderweg, op hun laatste GPS-positie. */
  ambulances?: Ambulance[];
  /** Standplaatsen waar de mobiele EHBO nu niet is: het kruisje grijs. */
  awayPostIds?: number[];
}>(), { posts: undefined, focusPostId: null, highlightRunId: null, showUser: true, picking: false, picked: null, interactive: true, alertPostIds: () => [], ambulances: () => [], awayPostIds: () => [] });

const emit = defineEmits<{ select: [postId: number]; pick: [lngLat: LngLat] }>();

const container = ref<HTMLDivElement>();
let map: maplibregl.Map | null = null;
let markers: maplibregl.Marker[] = [];
let ambulanceMarkers: maplibregl.Marker[] = [];
let userMarker: maplibregl.Marker | null = null;
let pickedMarker: maplibregl.Marker | null = null;
let watchId: number | null = null;

const GREY = '#9A9CA3';
const CROSS = '<svg width="16" height="16" viewBox="0 0 24 24" fill="#FFFFFF" aria-hidden="true"><path d="M9 3h6v6h6v6h-6v6H9v-6H3V9h6z"/></svg>';
const AMBULANCE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 10H6"/><path d="M8 8v4"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.3a1 1 0 0 0-.7-.9l-1.9-.7a1 1 0 0 1-.6-.5l-1.5-3a1 1 0 0 0-.9-.6H14"/><path d="M9 18h6"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';

/** Volgorde van de markeringen per soort, van onder naar boven. Eigen soorten liggen onderop, bij Anders. */
const MARKER_ORDER = ['anders', 'verkeer', 'water', 'stempel', 'ehbo', 'start_finish'];
/** Boven alle posten: de ambulance en je eigen positie. */
const EHBO_RANK = MARKER_ORDER.indexOf('ehbo');
const UNIT_LAYER = MARKER_ORDER.length + EHBO_RANK + 1;
/** Altijd bovenop: open oproep, geselecteerde post en het gekozen punt in beheer. */
const TOP_LAYER = UNIT_LAYER + 1;

/**
 * Rustige kaart: grijs met zachte pastels (water lichtblauw, groen salie), op de warme achtergrond van de app.
 * Geen iconen van winkels en horeca; het parcours en de gekleurde posten moeten opvallen.
 */
const MAP_FLAVOR: Flavor = {
  ...LIGHT,
  background: '#E9E7E1', earth: '#EFEDE8',
  park_a: '#DDE6D7', park_b: '#CFDDC9', wood_a: '#DAE4D3', wood_b: '#CCDAC6', scrub_a: '#DEE6D8', scrub_b: '#D2DECD',
  water: '#BCD3DF', buildings: '#E2DFD9', sand: '#ECE9DF', beach: '#EEEBE1',
  hospital: '#EDE6E4', school: '#ECE8E1', industrial: '#E6E6E3', pedestrian: '#ECEAE3', aerodrome: '#E8E7E3', zoo: '#E2E8DD',
  railway: '#C8C8C4', boundaries: '#BDBDB9',
  city_label: '#62666D', subplace_label: '#8A8D93', roads_label_minor: '#9A9CA1', roads_label_major: '#8A8D93',
  landcover: {
    grassland: '#DFE7D8', barren: '#EFECE3', urban_area: '#EAE8E3', farmland: '#E3EADC',
    glacier: '#FFFFFF', scrub: '#E1E7D9', forest: '#D3DFCD',
  },
  pois: undefined,
};

function style(): StyleSpecification {
  const m = props.pkg.map;
  const background = { id: 'achtergrond', type: 'background', paint: { 'background-color': MAP_FLAVOR.background } } as const;
  if (!m) return { version: 8, sources: {}, layers: [background] };
  return {
    version: 8,
    glyphs: assetUrl(m, 'fonts/{fontstack}/{range}.pbf'),
    sprite: assetUrl(m, 'sprites/v4/light'),
    sources: {
      protomaps: { type: 'vector', tiles: [tileUrl(m)], maxzoom: m.maxZoom, bounds: m.bbox, attribution: '© OpenStreetMap · Protomaps' },
    },
    layers: layers('protomaps', MAP_FLAVOR, { lang: 'nl' }),
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

/**
 * Layer of a post: open call and selected post on top, otherwise the order of its type.
 * A post with a standplaats only ever moves up: above every post without one, but below the EHBO posts.
 * Among posts with a standplaats the order of the types still holds, and EHBO and above keep their place.
 */
function postLayer(post: PackagePost, typeKey: string | null | undefined, onTop: boolean) {
  if (onTop) return TOP_LAYER;
  const rank = Math.max(MARKER_ORDER.indexOf(typeKey ?? ''), 0);
  const raised = rank >= EHBO_RANK || props.pkg.units.some((u) => u.postId === post.id);
  return rank + (raised ? EHBO_RANK : 0) + 1;
}

/** The run in focus, if it has a route on the map. */
const focusRun = () => props.pkg.runs.find((r) => r.id === props.highlightRunId && r.line) ?? null;

function markerElement(post: PackagePost) {
  const type = props.pkg.postTypes.find((t) => t.id === post.typeId);
  const el = document.createElement('button');
  el.type = 'button';
  const alert = props.alertPostIds.includes(post.id);
  const away = props.awayPostIds.includes(post.id);
  const focus = post.id === props.focusPostId;
  el.className = `post-marker${type?.key === 'ehbo' ? ' ehbo' : ''}${focus ? ' focus' : ''}${alert ? ' alert' : ''}`;
  el.style.zIndex = String(postLayer(post, type?.key, alert || focus));
  // Altijd de kleur van de soort post; een post met een open oproep rood.
  // Een EHBO-post waar de mobiele eenheid niet is: grijs.
  el.style.background = alert ? '#C8261E' : type?.key === 'ehbo' && away ? GREY : (type?.color ?? '#6B7079');
  // A run is chosen: what isn't on it steps back. You want to know where the nearest EHBO is, so that stays half visible.
  const run = focusRun();
  if (run && !alert && !focus && !isOnRun(props.pkg, post, run.id)) {
    const ehbo = type?.key === 'ehbo' || props.pkg.units.some((u) => u.postId === post.id);
    el.classList.add(ehbo ? 'dimmed' : 'faded');
  }
  const icon = postTypeIcon(type?.key);
  el.setAttribute('aria-label', away ? `${post.name}, EHBO onderweg` : post.name);
  if (type?.key === 'ehbo') el.innerHTML = CROSS;
  else {
    if (icon) el.innerHTML = iconSvg(icon, 16, 2.4);
    else {
      el.textContent = type?.letter ?? '';
      if ((type?.letter.length ?? 0) > 1) el.classList.add('small');
    }
    // Een EHBO-eenheid heeft hier haar standplaats: klein groen kruisje op de rand, grijs als ze onderweg is.
    if (props.pkg.units.some((u) => u.postId === post.id)) el.insertAdjacentHTML('beforeend', `<span class="ehbo-dot${away ? ' away' : ''}">${CROSS}</span>`);
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

/** Mobiele EHBO als ambulance: groen als ze beschikbaar is, rood bij pauze of tijdens een oproep. */
function drawAmbulances() {
  if (!map) return;
  for (const m of ambulanceMarkers) m.remove();
  ambulanceMarkers = props.ambulances.map((a) => {
    const el = document.createElement('div');
    el.className = `unit-marker${a.available ? '' : ' unavailable'}`;
    el.style.zIndex = String(UNIT_LAYER);
    el.setAttribute('role', 'img');
    el.setAttribute('aria-label', `EHBO ${a.name}, ${a.busy ? 'bezig met een oproep' : a.available ? 'beschikbaar' : 'niet beschikbaar'}`);
    el.innerHTML = AMBULANCE;
    return new maplibregl.Marker({ element: el }).setLngLat([a.lng, a.lat]).addTo(map!);
  });
}

function drawPicked() {
  if (!map) return;
  pickedMarker?.remove();
  pickedMarker = props.picked ? new maplibregl.Marker({ color: '#C8261E' }).setLngLat(props.picked).addTo(map) : null;
  if (pickedMarker) pickedMarker.getElement().style.zIndex = String(TOP_LAYER);
}

/** Het hele gebied in beeld, de gekozen route, of ingezoomd op één post. */
function frame(animate = false) {
  if (!map) return;
  const duration = animate ? 500 : 0;
  const focus = props.focusPostId !== null ? props.pkg.posts.find((p) => p.id === props.focusPostId) : undefined;
  if (focus?.lat != null && focus.lng != null) {
    map.jumpTo({ center: [focus.lng, focus.lat], zoom: 15 });
    return;
  }
  const run = focusRun();
  const points: LngLat[] = run ? run.line! : [
    ...props.pkg.runs.flatMap((r) => r.line ?? []),
    ...props.pkg.posts.filter((p) => p.lat !== null && p.lng !== null).map((p) => [p.lng!, p.lat!] as LngLat),
  ];
  const bounds = points.length ? points.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(points[0], points[0])) : null;
  if (bounds) map.fitBounds(bounds, { padding: 32, maxZoom: 16, duration });
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
  el.style.zIndex = String(UNIT_LAYER);
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
      // De gekozen loop bovenop, zodat hij nergens onder een andere loop verdwijnt.
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', ['get', 'highlight'], 1, 0] },
      paint: {
        'line-color': ['case', ['get', 'highlight'], '#16181D', '#9A9CA3'],
        'line-width': ['case', ['get', 'highlight'], 4, 3],
        'line-opacity': ['case', ['get', 'highlight'], 1, 0.35],
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

watch(() => [props.posts, props.pkg, props.focusPostId, props.highlightRunId, props.alertPostIds], drawPosts);
// Wordt elke tel opnieuw berekend; alleen opnieuw tekenen als er echt iets verandert.
watch(() => props.awayPostIds.join(), drawPosts);
watch(() => props.picked, drawPicked);
watch(() => props.ambulances, drawAmbulances);
// Naar een andere post (bijv. vanaf de postpagina): de kaart gaat mee.
watch(() => props.focusPostId, () => frame());
watch(() => props.highlightRunId, () => frame(true));
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
/* Geen position op de markers zelf: MapLibre zet ze absoluut; relatief maken laat ze verschuiven. */
.event-map { width: 100%; height: 100%; border-radius: 18px; overflow: hidden; background: #E9E7E1; }
.event-map.picking :deep(.maplibregl-canvas) { cursor: crosshair; }
.event-map :deep(.post-marker) {
  width: 28px; height: 28px; padding: 0; border-radius: 50%; border: 2px solid #FFFFFF; box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
  color: #FFFFFF; font: 700 12px var(--sans); display: flex; align-items: center; justify-content: center; cursor: pointer;
}
.event-map :deep(.post-marker.small) { font-size: 9px; letter-spacing: -0.02em; }
.event-map :deep(.post-marker.ehbo) { border-radius: 8px; }
/* !important: MapLibre sets opacity on every marker itself. */
.event-map :deep(.post-marker.dimmed) { opacity: .4 !important; }
.event-map :deep(.post-marker.faded) { opacity: .15 !important; pointer-events: none; }
.event-map :deep(.ehbo-dot) {
  position: absolute; right: -6px; bottom: -6px; width: 16px; height: 16px; border-radius: 5px; border: 1.5px solid #FFFFFF;
  background: #0A7D4F; display: flex; align-items: center; justify-content: center;
}
.event-map :deep(.ehbo-dot.away) { background: #9A9CA3; }
.event-map :deep(.ehbo-dot svg) { width: 10px; height: 10px; }
.event-map :deep(.unit-marker) {
  width: 28px; height: 28px; border-radius: 50%; background: #FFFFFF; border: 2px solid #0A7D4F; color: #0A7D4F;
  display: flex; align-items: center; justify-content: center; box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
}
.event-map :deep(.unit-marker.unavailable) { border-color: #C8261E; color: #C8261E; }
.event-map :deep(.post-marker.alert) { width: 32px; height: 32px; box-shadow: 0 0 0 10px rgba(200, 38, 30, .2); }
.event-map :deep(.post-marker.focus) { width: 36px; height: 36px; box-shadow: 0 0 0 8px rgba(31, 111, 178, .25); }
.event-map :deep(.user-dot) {
  width: 16px; height: 16px; border-radius: 50%; background: #1F6FB2; border: 3px solid #FFFFFF; box-shadow: 0 0 0 6px rgba(31, 111, 178, .25);
}
</style>
