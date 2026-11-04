// Terug en vooruit. Vegen (terug of vooruit) doet niets: elke navigatie vervangt het huidige scherm, dus de telefoon heeft
// nooit een vorige of volgende pagina om naar te vegen of als voorbeeld te tonen. Op Android sluit de terugknop van het
// toestel daardoor de app. Terug in de app (de pijl linksboven) gaat één stap omhoog, naar het hoofdscherm van wat je bekijkt:
// postdetail → kaart, beheer › post → beheer › posten, een tab → je startscherm.
import type { RouteLocation, RouteLocationRaw, Router } from 'vue-router';
import { coordinatorOf } from './locations.ts';
import { homeRoute } from './router.ts';
import { useLiveStore } from './stores/live.ts';
import { usePackageStore } from './stores/package.ts';
import { useSessionStore } from './stores/session.ts';

/** Vaste ouders: de terugknop bovenaan dezelfde schermen. */
const PARENT: Record<string, string> = {
  location: 'map', route: 'map', help: 'map',
  dispatch: 'first-aid', 'self-start': 'first-aid', assign: 'first-aid', 'assign-incident': 'assign',
  info: 'menu', check: 'menu', admin: 'menu', control: 'menu',
  'admin-location': 'admin-locations', 'admin-team': 'admin-teams', 'admin-zone': 'admin-zones',
  'admin-run': 'admin-event', 'admin-app-icon': 'admin-event', 'admin-report-print': 'admin-report',
};

/** Tijdens het aanmelden geldt de lijn nog niet: terug gaat dan naar je startscherm. */
const ONBOARDING = ['recognized', 'permissions'];

function active(route: RouteLocation) {
  return Boolean(useSessionStore().me) && (route.meta.staff || route.name === 'info' || route.name === 'route') && !ONBOARDING.includes(String(route.name));
}

function isHome(route: RouteLocation) {
  const home = homeRoute();
  return route.name === home.name && (!('params' in home) || String(route.params.id) === String(home.params?.id));
}

/** Een melding of aanvraag hoort bij je eigen post, anders bij Meldingen (coördinator, beheer), het EHBO-scherm of de kaart. */
function locationOrQueue(locationId: number | null | undefined): RouteLocationRaw {
  const me = useSessionStore().me!;
  if (locationId != null && me.assignments.some((a) => a.kind === 'location' && a.locationId === locationId)) return { name: 'location-home', params: { id: locationId } };
  if (me.isAdmin || coordinatorOf(usePackageStore().pkg)?.phone === me.phone) return { name: 'requests' };
  if (me.assignments.some((a) => a.kind === 'team')) return { name: 'first-aid' };
  return { name: 'map' };
}

/** Eén stap omhoog vanaf dit scherm; null op het startscherm. */
export function upOf(route: RouteLocation): RouteLocationRaw | null {
  if (isHome(route)) return null;
  const name = String(route.name);
  const live = useLiveStore();
  const p = route.params;
  switch (name) {
    case 'new-incident': return { name: 'location-home', params: { id: p.id } };
    case 'close-incident': return { name: 'dispatch', params: { id: p.id } };
    case 'location-incident': case 'location-request': return { name: 'location-history', params: { id: p.locationId } };
    case 'location-history': return { name: 'location-home', params: { id: p.id } };
    case 'incident': return locationOrQueue(live.incidentById(Number(p.id))?.locationId);
    case 'add-to-incident': return { name: 'incident', params: { id: p.incidentId } };
    case 'request': return locationOrQueue(live.requestById(Number(p.id))?.locationId);
    case 'no-signal': return locationOrQueue(live.outbox.find((i) => i.clientId === p.clientId)?.locationId);
  }
  if (PARENT[name]) return { name: PARENT[name] };
  if (name.startsWith('admin-')) return { name: 'admin' };
  // Een tab (kaart, meldingen, contacten, menu, EHBO, een post): terug naar je startscherm.
  return homeRoute();
}

export function installNavigation(router: Router) {
  const replace = router.replace.bind(router);
  router.push = (to) => replace(to);
  // Er is geen vorige pagina: terug in de app is één stap omhoog.
  router.back = () => {
    const route = router.currentRoute.value;
    const up = active(route) ? upOf(route) : null;
    void replace(up ?? (useSessionStore().me ? homeRoute() : { name: 'participant' }));
  };
}
