// Evenementpakket op de telefoon: vaste gegevens en de kaart, ook zonder bereik.
// De app haalt het pakket op bij het openen en zodra de live stand een nieuwe versie noemt; alleen een nieuwe versie komt over de lijn.
import { defineStore } from 'pinia';
import { computed, ref } from 'vue';
import type { EventPackage, PackageMap, PackagePost, PostTypeInfo } from '@ehbo/shared';
import { load, save } from '../storage.ts';

const MAP_CACHE_PREFIX = 'ehbo-map-';
const GPX_CACHE = 'ehbo-gpx';
const PARALLEL_DOWNLOADS = 6;

export const tileUrl = (map: PackageMap) => `${location.origin}/map/${map.version}/tiles/{z}/{x}/{y}.mvt`;
export const assetUrl = (map: PackageMap, path: string) => `${location.origin}/map/${map.version}/${path}`;

function mapUrls(map: PackageMap) {
  return [
    ...map.tiles.map(([z, x, y]) => `/map/${map.version}/tiles/${z}/${x}/${y}.mvt`),
    ...map.assets.map((path) => `/map/${map.version}/${path.split('/').map(encodeURIComponent).join('/')}`),
  ];
}

export const usePackageStore = defineStore('package', () => {
  const pkg = ref<EventPackage | null>(load('ehbo.package'));
  /** Versie van de kaart die volledig op de telefoon staat. */
  const cachedMapVersion = ref<number | null>(load('ehbo.mapCached'));
  let downloading: Promise<void> | null = null;

  const typeById = computed(() => new Map<number, PostTypeInfo>(pkg.value?.postTypes.map((t) => [t.id, t]) ?? []));
  const postById = computed(() => new Map<number, PackagePost>(pkg.value?.posts.map((p) => [p.id, p]) ?? []));

  function setPackage(value: EventPackage | null) {
    pkg.value = value;
    save('ehbo.package', value);
  }

  /** Does the package on this phone match the data version in the live state? */
  const isCurrent = (dataVersion: string) => pkg.value?.version.startsWith(`${dataVersion}.`) ?? false;

  /** Nieuwste versie ophalen; zonder bereik blijft de bewaarde versie staan. */
  async function refresh() {
    try {
      const res = await fetch('/api/package', { headers: pkg.value ? { 'If-None-Match': `"${pkg.value.version}"` } : {} });
      if (res.ok) {
        setPackage((await res.json()) as EventPackage);
        void cacheGpx();
      }
    } catch {
      // Geen bereik.
    }
    void cacheMap();
  }

  /** The route files, so the download works without signal too. */
  async function cacheGpx() {
    if (!('caches' in window)) return;
    try {
      const cache = await caches.open(GPX_CACHE);
      await Promise.all((pkg.value?.runs ?? []).filter((r) => r.line).map((r) => cache.add(`/gpx/${r.id}.gpx`)));
    } catch {
      // Geen bereik: de volgende nieuwe versie probeert het opnieuw.
    }
  }

  /** Alle kaarttegels vooraf opslaan, zodat de kaart overal werkt. Oude kaartversies gaan weg. */
  function cacheMap(): Promise<void> {
    const map = pkg.value?.map;
    if (!map || cachedMapVersion.value === map.version || !('caches' in window)) return Promise.resolve();
    downloading ??= (async () => {
      try {
        const cache = await caches.open(`${MAP_CACHE_PREFIX}${map.version}`);
        const urls = mapUrls(map);
        let next = 0;
        await Promise.all(Array.from({ length: PARALLEL_DOWNLOADS }, async () => {
          while (next < urls.length) {
            const url = urls[next++]!;
            if (!(await cache.match(url))) await cache.add(url);
          }
        }));
        cachedMapVersion.value = map.version;
        save('ehbo.mapCached', map.version);
        for (const key of await caches.keys()) {
          if (key.startsWith(MAP_CACHE_PREFIX) && key !== `${MAP_CACHE_PREFIX}${map.version}`) await caches.delete(key);
        }
      } catch {
        // Bereik weggevallen: bij de volgende keer openen gaat het verder waar het was.
      } finally {
        downloading = null;
      }
    })();
    return downloading;
  }

  /** Bij afmelden: namen en nummers van collega's horen niet op de telefoon te blijven. */
  function clearStaffData() {
    if (pkg.value?.staff) setPackage(null);
  }

  return { pkg, cachedMapVersion, typeById, postById, isCurrent, refresh, cacheMap, clearStaffData };
});
