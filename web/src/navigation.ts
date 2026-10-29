// Terug en vooruit met de gebaren van de telefoon. De app onthoudt niet elke stap: de geschiedenis is altijd
// [startscherm, huidig scherm]. Terug gaat één stap omhoog, naar het hoofdscherm van wat je bekijkt (postdetail → kaart,
// beheer › post → beheer › posten, een tab → je startscherm). Op het startscherm doet terug niets, net als vooruit.
// Alleen voor aangemelde medewerkers; aanmelden en de deelnemerspagina gedragen zich als een gewone website.
import type { RouteLocation, RouteLocationRaw, Router } from 'vue-router';
import { coordinatorOf } from './posts.ts';
import { homeRoute } from './router.ts';
import { useLiveStore } from './stores/live.ts';
import { usePackageStore } from './stores/package.ts';
import { useSessionStore } from './stores/session.ts';

/** Vaste ouders: de terugknop bovenaan dezelfde schermen. */
const PARENT: Record<string, string> = {
  post: 'kaart',
  oproep: 'stand-by', inzetten: 'stand-by',
  info: 'menu', controle: 'menu', beheer: 'menu',
  'beheer-post': 'beheer-posten', 'beheer-eenheid': 'beheer-eenheden',
  'beheer-loop': 'beheer-evenement', 'beheer-app-icoon': 'beheer-evenement', 'beheer-rapport-afdrukken': 'beheer-rapport',
};

/** Tijdens het aanmelden nog niet: daar mag je gewoon terug. */
const ONBOARDING = ['herkend', 'toestemmingen'];

function active(route: RouteLocation) {
  return Boolean(useSessionStore().me) && (route.meta.staff || route.name === 'info') && !ONBOARDING.includes(String(route.name));
}

function isHome(route: RouteLocation) {
  const home = homeRoute();
  return route.name === home.name && (!('params' in home) || String(route.params.id) === String(home.params?.id));
}

/** Een melding of aanvraag hoort bij je eigen post, anders bij Meldingen (coördinator, beheer), stand-by (EHBO) of de kaart. */
function postOrQueue(postId: number | null | undefined): RouteLocationRaw {
  const me = useSessionStore().me!;
  if (postId != null && me.assignments.some((a) => a.kind === 'post' && a.postId === postId)) return { name: 'post-home', params: { id: postId } };
  if (me.isAdmin || coordinatorOf(usePackageStore().pkg)?.phone === me.phone) return { name: 'meldingen' };
  if (me.assignments.some((a) => a.kind === 'ehbo')) return { name: 'stand-by' };
  return { name: 'kaart' };
}

/** Eén stap omhoog vanaf dit scherm; null op het startscherm. */
export function upOf(route: RouteLocation): RouteLocationRaw | null {
  if (isHome(route)) return null;
  const name = String(route.name);
  const live = useLiveStore();
  const p = route.params;
  switch (name) {
    case 'ehbo-verzoek': return { name: 'post-home', params: { id: p.id } };
    case 'afronden': return { name: 'oproep', params: { id: p.id } };
    case 'melding': return postOrQueue(live.incidentById(Number(p.id))?.postId);
    case 'aanvullen': return { name: 'melding', params: { id: p.incidentId } };
    case 'aanvraag': return postOrQueue(live.requestById(Number(p.id))?.postId);
    case 'geen-bereik': return postOrQueue(live.outbox.find((i) => i.clientId === p.clientId)?.postId);
  }
  if (PARENT[name]) return { name: PARENT[name] };
  if (name.startsWith('beheer-')) return { name: 'beheer' };
  // Een tab (kaart, meldingen, contacten, menu, stand-by, een post): terug naar je startscherm.
  return homeRoute();
}

export function installNavigation(router: Router) {
  /** Plek in de browsergeschiedenis van het huidige scherm en van het startscherm. */
  let position = 0;
  let homePosition: number | null = null;
  let goingHome = false;
  const historyPosition = () => (window.history.state?.position as number | undefined) ?? 0;

  // Naar een ander scherm: vanaf het startscherm een stap erbij, verder het huidige scherm vervangen.
  // Naar het startscherm: één stap terug, naar het startscherm dat er al onder ligt.
  const push = router.push.bind(router);
  router.push = (to) => {
    const target = router.resolve(to);
    const from = router.currentRoute.value;
    if (!active(from) || !active(target)) return push(to);
    if (isHome(target) && homePosition !== null && position === homePosition + 1) {
      goingHome = true;
      router.go(-1);
      return new Promise((resolve) => { const stop = router.afterEach(() => { stop(); resolve(); }); });
    }
    return isHome(from) ? push(to) : router.replace(to);
  };

  router.beforeEach((to, from) => {
    // Een eigen navigatie (tik, knop): daar heeft router.push al voor gezorgd.
    if (historyPosition() === position || !active(from)) return true;
    // Terug of vooruit met een gebaar.
    if (goingHome) {
      goingHome = false;
      return true;
    }
    if (historyPosition() > position || isHome(from)) return false;
    const up = upOf(from);
    if (!up) return false;
    const target = router.resolve(up);
    return target.fullPath === to.fullPath ? true : target;
  });

  // Alleen na een gelukte navigatie: bij een afgebroken gebaar zet de router de geschiedenis zelf terug.
  router.afterEach((to, _from, failure) => {
    if (failure) return;
    position = historyPosition();
    if (active(to) && isHome(to)) homePosition = position;
  });

  // Geopend op een ander scherm (bijv. via een melding): het startscherm eronder leggen, zodat terug daar uitkomt.
  void router.isReady().then(async () => {
    const route = router.currentRoute.value;
    if (!active(route) || isHome(route)) return;
    const path = route.fullPath;
    await router.replace(homeRoute());
    await push(path);
  });
}
