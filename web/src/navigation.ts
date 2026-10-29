// Terug en vooruit. Vegen (terug of vooruit) doet niets: elke navigatie vervangt het huidige scherm, dus de telefoon heeft
// nooit een vorige of volgende pagina om naar te vegen of als voorbeeld te tonen. Op Android sluit de terugknop van het
// toestel daardoor de app. Terug in de app (de pijl linksboven) gaat één stap omhoog, naar het hoofdscherm van wat je bekijkt:
// postdetail → kaart, beheer › post → beheer › posten, een tab → je startscherm.
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

/** Tijdens het aanmelden geldt de lijn nog niet: terug gaat dan naar je startscherm. */
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
  const replace = router.replace.bind(router);
  router.push = (to) => replace(to);
  // Er is geen vorige pagina: terug in de app is één stap omhoog.
  router.back = () => {
    const route = router.currentRoute.value;
    const up = active(route) ? upOf(route) : null;
    void replace(up ?? (useSessionStore().me ? homeRoute() : { name: 'deelnemer' }));
  };
}
