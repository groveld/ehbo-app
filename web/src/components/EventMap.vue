<script setup lang="ts">
// Kaart met parcours en posten. Tegels, lettertypen en iconen komen van de eigen server (en staan offline in de cache).
import { onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { messageDialog } from '../composables/useDialog.ts';
import { isIOS } from '../platform.ts';
import Icon from './Icon.vue';
import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { LIGHT, layers, type Flavor } from '@protomaps/basemaps';
// MapLibre laadt zijn worker als los bestand; Vite ziet dat adres niet vanzelf, dus geven we het mee.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { MARKER_ORDER, markerRank, type Bbox, type EventPackage, type LngLat, type PackagePost } from '@ehbo/shared';
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
  /** Only the highlighted run, with its start and finish marked. */
  onlyHighlighted?: boolean;
  /** Mark focusPostId, but frame the whole route: where a call is only means something in relation to the course. */
  wholeRoute?: boolean;
  showUser?: boolean;
  /** Beheer: tik op de kaart om een punt te kiezen. */
  picking?: boolean;
  picked?: LngLat | null;
  interactive?: boolean;
  /** Posten met een open oproep: rood, met een gloed. */
  alertPostIds?: number[];
  /** Posts with an open request: an amber glow, less urgent than a call. */
  taskPostIds?: number[];
  /** From a team to the call it's going to. */
  lines?: [LngLat, LngLat][];
  /** Mobiele EHBO-eenheden onderweg, op hun laatste GPS-positie. */
  ambulances?: Ambulance[];
  /** Standplaatsen waar de mobiele EHBO nu niet is: het kruisje grijs. */
  awayPostIds?: number[];
  /** Kept in memory but not in view: no location, and nothing happens until it's back. */
  paused?: boolean;
}>(), { posts: undefined, focusPostId: null, highlightRunId: null, onlyHighlighted: false, wholeRoute: false, showUser: true, picking: false, picked: null, interactive: true, alertPostIds: () => [], taskPostIds: () => [], lines: () => [], ambulances: () => [], awayPostIds: () => [], paused: false });

const emit = defineEmits<{ select: [postId: number]; pick: [lngLat: LngLat] }>();

const container = ref<HTMLDivElement>();
let map: maplibregl.Map | null = null;
let markers: maplibregl.Marker[] = [];
let ambulanceMarkers: maplibregl.Marker[] = [];
let userMarker: maplibregl.Marker | null = null;
let pickedMarker: maplibregl.Marker | null = null;
let watchId: number | null = null;
let contextLost = false;
/** Own position (#38): only on this phone, never sent. Mijn locatie centres once; a second tap follows until you move the map. */
const locating = ref<'off' | 'shown' | 'follow'>('off');
let userFix: { lng: number; lat: number; accuracy: number } | null = null;
/** A fix worse than this shows a greyer dot. */
const ROUGH_FIX_M = 50;

const GREY = '#9A9CA3';
const CROSS = iconSvg('ehbo', 16);
const AMBULANCE = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 10H6"/><path d="M8 8v4"/><path d="M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2"/><path d="M19 18h2a1 1 0 0 0 1-1v-3.3a1 1 0 0 0-.7-.9l-1.9-.7a1 1 0 0 1-.6-.5l-1.5-3a1 1 0 0 0-.9-.6H14"/><path d="M9 18h6"/><circle cx="17" cy="18" r="2"/><circle cx="7" cy="18" r="2"/></svg>';

/** Volgorde van de markeringen per soort, van onder naar boven. Eigen soorten liggen onderop, bij Anders. */
// The order of functions lives in @ehbo/shared (MARKER_ORDER): it also decides a location's main function.
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
      protomaps: { type: 'vector', tiles: [tileUrl(m)], maxzoom: m.maxZoom, bounds: m.bbox },
    },
    layers: layers('protomaps', MAP_FLAVOR, { lang: 'nl' }),
  };
}

/** A small arrowhead pointing along the line. Drawn here, so it works offline and needs no sprite. */
function arrowImage() {
  const size = 40;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(33, 20);
  ctx.lineTo(8, 8);
  ctx.lineTo(14, 20);
  ctx.lineTo(8, 32);
  ctx.closePath();
  ctx.strokeStyle = '#FFFFFF';
  ctx.lineWidth = 7;
  ctx.stroke();
  ctx.fillStyle = '#16181D';
  ctx.fill();
  return ctx.getImageData(0, 0, size, size);
}

/** One round of the dashes along the line, so they move from the team towards the call. */
const DASH_STEPS = [
  [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
  [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
];
const DASH_STEP_MS = 90;

const lineFeatures = () => ({
  type: 'FeatureCollection' as const,
  features: props.lines.map((coordinates) => ({ type: 'Feature' as const, properties: {}, geometry: { type: 'LineString' as const, coordinates } })),
});

function runFeatures() {
  const routes = props.pkg.runs.filter((r) => r.line).length;
  return {
    type: 'FeatureCollection' as const,
    features: props.pkg.runs.filter((r) => r.line && (!props.onlyHighlighted || r.id === props.highlightRunId)).flatMap((r) => [
      {
        type: 'Feature' as const,
        // Arrows on all routes at once would be too busy: only on the chosen one, or if there's just one.
        properties: { highlight: props.highlightRunId === null || props.highlightRunId === r.id, arrows: props.highlightRunId === r.id || routes === 1 },
        geometry: { type: 'LineString' as const, coordinates: r.line! },
      },
      ...(props.onlyHighlighted ? [
        { type: 'Feature' as const, properties: { color: '#0A7D4F' }, geometry: { type: 'Point' as const, coordinates: r.line![0]! } },
        { type: 'Feature' as const, properties: { color: '#16181D' }, geometry: { type: 'Point' as const, coordinates: r.line!.at(-1)! } },
      ] : []),
    ]),
  };
}

/**
 * Layer of a post: open call and selected post on top, otherwise the order of its type.
 * A post with a standplaats only ever moves up: above every post without one, but below the EHBO posts.
 * Among posts with a standplaats the order of the types still holds, and EHBO and above keep their place.
 */
function postLayer(post: PackagePost, typeKey: string | null | undefined, onTop: boolean) {
  if (onTop) return TOP_LAYER;
  const rank = markerRank(typeKey);
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
  const task = !alert && props.taskPostIds.includes(post.id);
  el.className = `post-marker${type?.key === 'ehbo' ? ' ehbo' : ''}${focus ? ' focus' : ''}${alert ? ' alert' : ''}${task ? ' task' : ''}`;
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
/** The chosen run, or else everything on the map. The posts shown count too: a call can be at a post the package doesn't have yet. */
function routeBounds() {
  const run = focusRun();
  const located = [...props.pkg.posts, ...(props.posts ?? [])].filter((p) => p.lat !== null && p.lng !== null).map((p) => [p.lng!, p.lat!] as LngLat);
  const points: LngLat[] = run ? run.line! : [...props.pkg.runs.flatMap((r) => r.line ?? []), ...located];
  return points.length ? points.reduce((b, p) => b.extend(p), new maplibregl.LngLatBounds(points[0], points[0])) : null;
}

/** Zoomed in or moved away: on return the whole route comes back into view. */
function showRouteAgain() {
  const bounds = routeBounds();
  const view = map?.getBounds();
  if (bounds && view && !(view.contains(bounds.getNorthEast()) && view.contains(bounds.getSouthWest()))) frame(true);
}

function frame(animate = false) {
  if (!map) return;
  const duration = animate ? 500 : 0;
  const focus = props.focusPostId !== null ? props.pkg.posts.find((p) => p.id === props.focusPostId) : undefined;
  if (!props.wholeRoute && focus?.lat != null && focus.lng != null) {
    map.jumpTo({ center: [focus.lng, focus.lat], zoom: 15 });
    return;
  }
  const bounds = routeBounds();
  if (bounds) map.fitBounds(bounds, { padding: 32, maxZoom: 16, duration });
  else if (props.pkg.map) map.fitBounds(props.pkg.map.bbox as Bbox, { duration: 0 });
}

/** The light circle around the dot: the accuracy in metres, at this zoom. MapLibre has 512 px tiles. */
function drawAccuracy() {
  const ring = userMarker?.getElement().querySelector<HTMLElement>('.accuracy');
  if (!map || !ring || !userFix) return;
  const metresPerPixel = (40_075_016.686 * Math.cos((userFix.lat * Math.PI) / 180)) / (512 * 2 ** map.getZoom());
  const size = Math.max(0, Math.min(2000, (2 * userFix.accuracy) / metresPerPixel));
  ring.style.width = ring.style.height = `${size}px`;
  userMarker!.getElement().classList.toggle('rough', userFix.accuracy > ROUGH_FIX_M);
}

const centreOnUser = () => {
  if (map && userFix) map.easeTo({ center: [userFix.lng, userFix.lat], zoom: Math.max(map.getZoom(), 15), duration: 400 });
};

function explainLocation(denied: boolean) {
  void messageDialog({
    title: denied ? 'Geen toestemming voor locatie' : 'Geen locatie gevonden',
    text: denied
      ? `Zet locatie aan voor deze app: ${isIOS ? 'Instellingen › Privacy en beveiliging › Locatievoorzieningen' : 'tik op het slotje of de instellingen van de app › Locatie'}. Je positie blijft op je telefoon.`
      : 'Ga naar buiten of probeer het zo opnieuw. De kaart werkt ook zonder.',
    confirm: 'Begrepen',
  });
}

/** Own position as a blue dot. Without asking only when the app already may; Mijn locatie asks. */
async function startUserLocation(ask = false) {
  if (!props.showUser || props.paused || watchId !== null || !('geolocation' in navigator)) return;
  if (!ask) {
    try {
      if (!navigator.permissions || (await navigator.permissions.query({ name: 'geolocation' })).state !== 'granted' || props.paused) return;
    } catch {
      return;
    }
  }
  watchId = navigator.geolocation.watchPosition(({ coords }) => {
    userFix = { lng: coords.longitude, lat: coords.latitude, accuracy: coords.accuracy };
    if (!map) return;
    if (!userMarker) {
      const el = document.createElement('div');
      el.className = 'user-dot';
      el.style.zIndex = String(UNIT_LAYER);
      el.innerHTML = '<span class="accuracy"></span>';
      userMarker = new maplibregl.Marker({ element: el }).setLngLat([coords.longitude, coords.latitude]).addTo(map);
      if (locating.value !== 'off') centreOnUser();
    }
    userMarker.setLngLat([coords.longitude, coords.latitude]);
    drawAccuracy();
    if (locating.value === 'follow') map.easeTo({ center: [coords.longitude, coords.latitude], duration: 300 });
  }, (err) => {
    if (locating.value === 'off') return;
    locating.value = 'off';
    stopUserLocation();
    explainLocation(err.code === err.PERMISSION_DENIED);
  }, { enableHighAccuracy: true, maximumAge: 10_000 });
}

/** Mijn locatie: first centre on you (asking for permission when needed), then follow you. */
function myLocation() {
  if (!('geolocation' in navigator)) {
    explainLocation(false);
    return;
  }
  if (locating.value !== 'off' && userFix) {
    locating.value = 'follow';
    centreOnUser();
    return;
  }
  locating.value = 'shown';
  if (watchId === null) void startUserLocation(true);
  else centreOnUser();
}

function createMap() {
  map = new maplibregl.Map({
    container: container.value!,
    style: style(),
    // The credit is on the intro and the info page, so the map shows only the map.
    attributionControl: false,
    interactive: props.interactive,
    maxZoom: 18,
    // Only moving and zooming: no tilting or turning, by touch, mouse or keyboard.
    maxPitch: 0,
    touchPitch: false,
    pitchWithRotate: false,
    dragRotate: false,
  });
  map.on('webglcontextlost', () => { contextLost = true; });
  map.on('zoom', drawAccuracy);
  // Moving the map yourself stops following.
  map.on('dragstart', () => { if (locating.value === 'follow') locating.value = 'shown'; });
  map.on('webglcontextrestored', () => { contextLost = false; });
  map.touchZoomRotate.disableRotation();
  map.keyboard.disableRotation();
  map.on('load', () => {
    // De bronvermelding begint ingeklapt (alleen het ⓘ-knopje), zodat hij de kaart niet bedekt.
    container.value?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
    map!.addSource('lopen', { type: 'geojson', data: runFeatures() });
    map!.addSource('oproeplijnen', { type: 'geojson', data: lineFeatures() });
    map!.addLayer({
      id: 'lopen',
      type: 'line',
      source: 'lopen',
      filter: ['==', ['geometry-type'], 'LineString'],
      // De gekozen loop bovenop, zodat hij nergens onder een andere loop verdwijnt.
      layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['case', ['get', 'highlight'], 1, 0] },
      paint: {
        'line-color': ['case', ['get', 'highlight'], '#16181D', '#9A9CA3'],
        'line-width': ['case', ['get', 'highlight'], 4, 3],
        'line-opacity': ['case', ['get', 'highlight'], 1, 0.35],
      },
    });
    map!.addLayer({
      id: 'oproeplijnen',
      type: 'line',
      source: 'oproeplijnen',
      paint: { 'line-color': '#C8261E', 'line-width': 3, 'line-dasharray': DASH_STEPS[0]! },
    });
    map!.addImage('route-arrow', arrowImage(), { pixelRatio: 2 });
    map!.addLayer({
      id: 'route-arrows',
      type: 'symbol',
      source: 'lopen',
      filter: ['all', ['==', ['geometry-type'], 'LineString'], ['get', 'arrows']],
      layout: {
        'symbol-placement': 'line',
        'symbol-spacing': 70,
        'icon-image': 'route-arrow',
        'icon-rotation-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        // Beside the line, on the right of the running direction: out and back over the same road then reads as two lanes.
        'icon-offset': [0, 9],
      },
    });
    map!.addLayer({
      id: 'route-ends',
      type: 'circle',
      source: 'lopen',
      filter: ['==', ['geometry-type'], 'Point'],
      paint: { 'circle-radius': 7, 'circle-color': ['get', 'color'], 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2 },
    });
  });
  map.on('click', (e) => {
    if (props.picking) emit('pick', [Math.round(e.lngLat.lng * 1e6) / 1e6, Math.round(e.lngLat.lat * 1e6) / 1e6]);
  });
  drawPosts();
  drawAmbulances();
  drawPicked();
  frame();
}

// A phone can take the graphics memory of an app in the background, which leaves the map black. It usually comes back by itself; if not, start the map again.
function restoreMap() {
  if (document.visibilityState !== 'visible' || !contextLost || props.paused) return;
  setTimeout(() => {
    if (!contextLost || !map) return;
    contextLost = false;
    map.remove();
    markers = [];
    ambulanceMarkers = [];
    pickedMarker = null;
    userMarker = null;
    createMap();
  }, 500);
}

onMounted(() => {
  createMap();
  void startUserLocation();
  document.addEventListener('visibilitychange', restoreMap);
});

watch(() => [props.posts, props.pkg, props.focusPostId, props.highlightRunId, props.alertPostIds, props.taskPostIds], drawPosts);
// Wordt elke tel opnieuw berekend; alleen opnieuw tekenen als er echt iets verandert.
watch(() => props.awayPostIds.join(), drawPosts);
watch(() => props.picked, drawPicked);
watch(() => props.ambulances, drawAmbulances);
// Recalculated every second; only redraw when a line really moved.
watch(() => JSON.stringify(props.lines), () => (map?.getSource('oproeplijnen') as GeoJSONSource | undefined)?.setData(lineFeatures()));

// Only while there's a line to see: every step redraws the map.
let dashTimer: ReturnType<typeof setInterval> | undefined;
watch(() => props.lines.length > 0 && !props.paused, (moving) => {
  clearInterval(dashTimer);
  if (!moving || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  let step = 0;
  dashTimer = setInterval(() => {
    if (document.visibilityState !== 'visible' || !map?.getLayer('oproeplijnen')) return;
    step = (step + 1) % DASH_STEPS.length;
    map.setPaintProperty('oproeplijnen', 'line-dasharray', DASH_STEPS[step]);
  }, DASH_STEP_MS);
}, { immediate: true });
// Naar een andere post (bijv. vanaf de postpagina): de kaart gaat mee.
watch(() => props.focusPostId, () => frame());
watch(() => props.highlightRunId, () => frame(true));
watch(() => [props.highlightRunId, props.pkg], () => (map?.getSource('lopen') as GeoJSONSource | undefined)?.setData(runFeatures()));

function stopUserLocation() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null;
}

watch(() => props.paused, (paused) => {
  if (paused) {
    stopUserLocation();
    return;
  }
  map?.resize();
  restoreMap();
  showRouteAgain();
  void startUserLocation();
});

onBeforeUnmount(() => {
  clearInterval(dashTimer);
  document.removeEventListener('visibilitychange', restoreMap);
  stopUserLocation();
  map?.remove();
  map = null;
});
</script>

<template>
  <div class="event-map-wrap">
    <div ref="container" class="event-map" :class="{ picking }" />
    <button
      v-if="showUser && interactive" class="locate" :class="{ on: locating !== 'off', follow: locating === 'follow' }"
      :aria-label="locating === 'shown' ? 'Mijn locatie volgen' : 'Mijn locatie'" :aria-pressed="locating !== 'off'" @click="myLocation"
    ><Icon name="gps" :size="22" /></button>
  </div>
</template>

<style scoped>
.event-map-wrap { position: relative; width: 100%; height: 100%; }
.locate {
  position: absolute; right: 10px; bottom: 10px; z-index: 1; width: 44px; height: 44px; border-radius: 12px; border: 0;
  background: #FFFFFF; color: var(--ink); box-shadow: 0 1px 4px rgba(0, 0, 0, .3); display: flex; align-items: center; justify-content: center;
}
.locate.on { color: #1F6FB2; }
.locate.follow { background: #1F6FB2; color: #FFFFFF; }
/* Geen position op de markers zelf: MapLibre zet ze absoluut; relatief maken laat ze verschuiven. */
/* isolate: the markers' z-index only counts inside the map, so a banner or button over the map stays on top. */
.event-map { isolation: isolate; width: 100%; height: 100%; border-radius: 18px; overflow: hidden; background: #E9E7E1; }
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
.event-map :deep(.post-marker.focus) { width: 36px; height: 36px; box-shadow: 0 0 0 8px rgba(31, 111, 178, .25); }
/* A blinking glow, so you see at once where something is going on. Only the shadow: MapLibre positions markers with transform. */
.event-map :deep(.post-marker.alert) { width: 32px; height: 32px; --glow: rgba(200, 38, 30, .55); box-shadow: 0 0 0 10px var(--glow); animation: glow 1.2s ease-in-out infinite; }
.event-map :deep(.post-marker.task) { --glow: rgba(217, 120, 28, .55); box-shadow: 0 0 0 8px var(--glow); animation: glow 1.6s ease-in-out infinite; }
@keyframes glow { 50% { box-shadow: 0 0 0 12px transparent; } }
@media (prefers-reduced-motion: reduce) {
  .event-map :deep(.post-marker.alert), .event-map :deep(.post-marker.task) { animation: none; }
}
.event-map :deep(.user-dot) {
  width: 16px; height: 16px; border-radius: 50%; background: #1F6FB2; border: 3px solid #FFFFFF; box-shadow: 0 1px 3px rgba(0, 0, 0, .3);
}
.event-map :deep(.user-dot.rough) { background: #7D8FA3; }
/* How precise the fix is: a light circle in metres, drawn under the dot. */
.event-map :deep(.user-dot .accuracy) {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: -1; border-radius: 50%; pointer-events: none;
  background: rgba(31, 111, 178, .14); border: 1px solid rgba(31, 111, 178, .35);
}
</style>
