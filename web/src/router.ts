import { createRouter, createWebHistory } from 'vue-router';
import { canUseAsStaff } from './platform.ts';
import { useSessionStore } from './stores/session.ts';

/** EHBO'ers naar stand-by, wie bij een post staat naar die post (als verantwoordelijke eerst), de rest naar de kaart. */
export function homeRoute() {
  const session = useSessionStore();
  const me = session.me!;
  if (me.home === 'ehbo') return { name: 'stand-by' };
  if (me.home === 'post') {
    const post = me.assignments.find((a) => a.kind === 'post' && a.role === 'verantwoordelijke') ?? me.assignments.find((a) => a.kind === 'post');
    if (post?.postId) return { name: 'post-home', params: { id: post.postId } };
  }
  return { name: 'kaart' };
}

declare module 'vue-router' {
  interface RouteMeta {
    /** Alleen voor aangemelde medewerkers. */
    staff?: boolean;
    /** Alleen voor beheerders. */
    admin?: boolean;
  }
}

export const router = createRouter({
  history: createWebHistory(),
  routes: [
    // Zonder aanmelding opent de app op de deelnemerspagina; daar kun je je als medewerker aanmelden.
    { path: '/', name: 'deelnemer', component: () => import('./views/DeelnemerView.vue') },
    { path: '/installeren', name: 'installeren', component: () => import('./views/InstallerenView.vue') },
    { path: '/aanmelden', name: 'aanmelden', component: () => import('./views/AanmeldenView.vue') },
    { path: '/onbekend', name: 'onbekend', component: () => import('./views/OnbekendView.vue') },
    { path: '/herkend', name: 'herkend', component: () => import('./views/HerkendView.vue'), meta: { staff: true } },
    { path: '/info', name: 'info', component: () => import('./views/InfoView.vue') },
    { path: '/toestemmingen', name: 'toestemmingen', component: () => import('./views/ToestemmingenView.vue'), meta: { staff: true } },
    // /start stuurt altijd door naar het startscherm van je rol (zie beforeEach).
    { path: '/start', name: 'start', component: () => import('./views/MenuView.vue'), meta: { staff: true } },
    { path: '/menu', name: 'menu', component: () => import('./views/MenuView.vue'), meta: { staff: true } },
    // Overzicht: de tabs van de tabbalk. De postenlijst staat onder de kaart.
    { path: '/overzicht/kaart', name: 'kaart', component: () => import('./views/overzicht/KaartView.vue'), meta: { staff: true } },
    { path: '/overzicht/meldingen', name: 'meldingen', component: () => import('./views/overzicht/MeldingenTab.vue'), meta: { staff: true } },
    { path: '/overzicht/contacten', name: 'contacten', component: () => import('./views/overzicht/ContactenTab.vue'), meta: { staff: true } },
    { path: '/post/:id', name: 'post', component: () => import('./views/PostDetailView.vue'), props: true, meta: { staff: true } },
    // Post: startscherm (3.1/3.2), EHBO-verzoek (4.1) en de melding daarna (4.2/4.6).
    { path: '/post/:id/start', name: 'post-home', component: () => import('./views/PostHomeView.vue'), props: true, meta: { staff: true } },
    { path: '/post/:id/ehbo', name: 'ehbo-verzoek', component: () => import('./views/EhboVerzoekView.vue'), props: true, meta: { staff: true } },
    { path: '/melding/:id', name: 'melding', component: () => import('./views/MeldingView.vue'), props: true, meta: { staff: true } },
    { path: '/aanvraag/:id', name: 'aanvraag', component: () => import('./views/AanvraagView.vue'), props: true, meta: { staff: true } },
    { path: '/geen-bereik/:clientId', name: 'geen-bereik', component: () => import('./views/GeenBereikView.vue'), props: true, meta: { staff: true } },
    { path: '/melding/:incidentId/aanvullen', name: 'aanvullen', component: () => import('./views/EhboVerzoekView.vue'), props: true, meta: { staff: true } },
    // EHBO: stand-by (3.3), oproep (4.3–4.7) en afronden (4.8).
    { path: '/stand-by', name: 'stand-by', component: () => import('./views/StandbyView.vue'), meta: { staff: true } },
    { path: '/oproep/:id', name: 'oproep', component: () => import('./views/OproepView.vue'), props: true, meta: { staff: true } },
    { path: '/oproep/:id/afronden', name: 'afronden', component: () => import('./views/AfrondenView.vue'), props: true, meta: { staff: true } },
    { path: '/controle', name: 'controle', component: () => import('./views/ControleView.vue'), meta: { staff: true } },
    { path: '/beheer', name: 'beheer', component: () => import('./views/admin/BeheerView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/evenement', name: 'beheer-evenement', component: () => import('./views/admin/EvenementView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/info', name: 'beheer-info', component: () => import('./views/admin/InfoBeheerView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/kernteam', name: 'beheer-kernteam', component: () => import('./views/admin/KernteamView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/noodnummers', name: 'beheer-noodnummers', component: () => import('./views/admin/NoodnummersView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/beheerders', name: 'beheer-beheerders', component: () => import('./views/admin/BeheerdersView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/rapport', name: 'beheer-rapport', component: () => import('./views/admin/RapportView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/rapport/afdrukken', name: 'beheer-rapport-afdrukken', component: () => import('./views/admin/RapportAfdrukView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/app-icoon', name: 'beheer-app-icoon', component: () => import('./views/admin/AppIcoonView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/lopen/:id', name: 'beheer-loop', component: () => import('./views/admin/LoopView.vue'), props: true, meta: { staff: true, admin: true } },
    { path: '/beheer/posten', name: 'beheer-posten', component: () => import('./views/admin/PostenView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/posten/:id', name: 'beheer-post', component: () => import('./views/admin/PostView.vue'), props: true, meta: { staff: true, admin: true } },
    { path: '/beheer/eenheden', name: 'beheer-eenheden', component: () => import('./views/admin/EenhedenView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/eenheden/:id', name: 'beheer-eenheid', component: () => import('./views/admin/EenheidView.vue'), props: true, meta: { staff: true, admin: true } },
    { path: '/:pad(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const session = useSessionStore();
  if (to.meta.staff && !session.me) return { name: 'deelnemer' };
  if (to.meta.admin && !session.me?.isAdmin) return { name: 'start' };
  // Aangemeld: het startscherm in plaats van de deelnemerspagina.
  if (to.name === 'deelnemer' && session.me) return { name: 'start' };
  // Startscherm volgens de belangrijkste rol: stand-by, de eigen post, of het overzicht.
  if (to.name === 'start' && session.me) return homeRoute();
  // Medewerkers zetten de app eerst op het beginscherm.
  if (to.name === 'aanmelden' && !canUseAsStaff) return { name: 'installeren' };
});
