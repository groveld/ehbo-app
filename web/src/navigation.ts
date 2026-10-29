// Terug en vooruit met de gebaren van de telefoon. Terug gaat één stap omhoog, naar het hoofdscherm van wat je bekijkt
// (postdetail → kaart, beheer › post → beheer › posten, een tab → je startscherm); vooruit doet niets.
// Een gebaar afbreken kan niet zonder dat je de verkeerde pagina even ziet. Daarom ligt de geschiedenis altijd al goed:
// onder elk scherm ligt het scherm erboven ([startscherm, …, ouder, scherm]) en er is niets om vooruit naar te gaan.
// Dat regelen we bij elke navigatie stil, terwijl de router even niet luistert: het scherm blijft gewoon staan.
// Alleen voor aangemelde medewerkers; aanmelden en de deelnemerspagina gedragen zich als een gewone website.
import type { NavigationFailure, RouteLocation, RouteLocationRaw, Router } from 'vue-router';
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
  const history = router.options.history;
  const basePush = router.push.bind(router);
  const baseReplace = router.replace.bind(router);
  const historyState = () => window.history.state as { position?: number; back?: string | null; dup?: boolean } | null;
  const positionNow = () => historyState()?.position ?? 0;

  /** Plek van het startscherm in de geschiedenis; daarboven één stap per niveau. */
  let homePosition: number | null = null;
  let lastPosition = positionNow();
  /** Een eigen navigatie of opruimactie: dan is een lagere plek geen terug-gebaar. */
  let arranging = false;

  /** Door de geschiedenis zonder iets te tonen: de router luistert even niet. */
  function silentGo(delta: number) {
    if (!delta) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const done = () => {
        clearTimeout(timer);
        window.removeEventListener('popstate', done);
        router.listening = true;
        resolve();
      };
      const timer = setTimeout(done, 600);
      router.listening = false;
      window.addEventListener('popstate', done);
      window.history.go(delta);
    });
  }
  /** Een stap erbij zonder te navigeren; een kopie van het startscherm heeft dup, zodat terug daar eerst niets doet. */
  const silentPush = (path: string, dup = false) => history.push(path, dup ? { dup: true } : undefined);

  /** [startscherm, …, ouder, scherm] als paden. */
  function lineage(route: RouteLocation): string[] {
    const paths = [route.fullPath];
    let current = route;
    for (let i = 0; i < 8; i++) {
      const up = upOf(current);
      if (!up) break;
      current = router.resolve(up);
      paths.unshift(current.fullPath);
    }
    return paths;
  }

  async function arrange<T>(work: () => Promise<T>): Promise<T> {
    arranging = true;
    try {
      return await work();
    } finally {
      arranging = false;
      lastPosition = positionNow();
    }
  }

  // Naar een scherm: eerst stil terug naar het gedeelde deel van de lijn, ontbrekende ouders erbij, dan het scherm zelf.
  // Zo ligt eronder altijd de ouder (die je bij terug te zien krijgt) en verdwijnt wat er vooruit lag.
  function navigate(to: RouteLocationRaw, replace: boolean): Promise<NavigationFailure | void | undefined> {
    const from = router.currentRoute.value;
    let target = router.resolve(to);
    if (target.name === 'start' && active(from)) target = router.resolve(homeRoute());
    const plain = () => (replace ? baseReplace(to) : basePush(to));
    if (!active(from) || !active(target) || homePosition === null) return plain();
    if (target.fullPath === from.fullPath) return Promise.resolve();
    const want = lineage(target);
    const have = lineage(from);
    if (want[0] !== have[0]) return plain();

    if (want.length === 1) {
      // Naar het startscherm: stil erheen, tonen, en er een kopie op leggen zodat er niets meer vooruit ligt.
      const delta = homePosition - positionNow();
      if (delta > 0) return plain();
      return arrange(async () => {
        await silentGo(delta);
        const result = await baseReplace(target.fullPath);
        silentPush(target.fullPath, true);
        return result;
      });
    }
    let shared = 1;
    while (shared < want.length - 1 && shared < have.length && want[shared] === have[shared]) shared++;
    const delta = homePosition + shared - 1 - positionNow();
    if (delta > 0) return plain();
    return arrange(async () => {
      await silentGo(delta);
      for (const path of want.slice(shared, -1)) silentPush(path);
      return basePush(target.fullPath);
    });
  }
  router.push = (to) => navigate(to, false);
  router.replace = (to) => navigate(to, true);

  /** Na een terug-gebaar: wat er vooruit ligt weghalen. Het scherm eronder blijft de ouder. */
  function clearForward(to: RouteLocation) {
    return arrange(async () => {
      if (isHome(to)) {
        silentPush(to.fullPath, true);
        return;
      }
      await silentGo(-1);
      silentPush(to.fullPath);
    });
  }

  router.afterEach((to, from, failure) => {
    if (failure) return;
    const position = positionNow();
    const back = !arranging && position < lastPosition && active(to) && to.fullPath !== from.fullPath;
    lastPosition = position;
    if (active(to) && isHome(to) && !historyState()?.dup) homePosition = position;
    if (back) void clearForward(to);
    // Net aangemeld: een kopie van het startscherm, zodat terug niet meteen naar de aanmeldschermen gaat.
    else if (!arranging && active(to) && isHome(to) && !active(from) && from.matched.length) void arrange(async () => silentPush(to.fullPath, true));
  });

  // Geopend op een ander scherm (bijv. via een melding): de lijn eronder leggen, zodat terug bij de ouder en het startscherm uitkomt.
  // Na herladen staat de geschiedenis er al (er is een vorige pagina); dan alleen bepalen waar het startscherm ligt.
  void router.isReady().then(() => {
    const route = router.currentRoute.value;
    lastPosition = positionNow();
    if (!active(route) || isHome(route)) return;
    const paths = lineage(route);
    if (!historyState()?.back) {
      history.replace(paths[0]!);
      for (const path of paths.slice(1)) history.push(path);
    }
    homePosition = positionNow() - (paths.length - 1);
    lastPosition = positionNow();
  });
}
