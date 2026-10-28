import { createRouter, createWebHistory } from 'vue-router';
import { canUseAsStaff } from './platform.ts';
import { useSessionStore } from './stores/session.ts';

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
    { path: '/', name: 'welkom', component: () => import('./views/WelkomView.vue') },
    { path: '/installeren', name: 'installeren', component: () => import('./views/InstallerenView.vue') },
    { path: '/aanmelden', name: 'aanmelden', component: () => import('./views/AanmeldenView.vue') },
    { path: '/onbekend', name: 'onbekend', component: () => import('./views/OnbekendView.vue') },
    { path: '/herkend', name: 'herkend', component: () => import('./views/HerkendView.vue'), meta: { staff: true } },
    { path: '/info', name: 'info', component: () => import('./views/InfoView.vue') },
    { path: '/toestemmingen', name: 'toestemmingen', component: () => import('./views/ToestemmingenView.vue'), meta: { staff: true } },
    { path: '/start', name: 'start', component: () => import('./views/StartView.vue'), meta: { staff: true } },
    { path: '/menu', name: 'menu', component: () => import('./views/StartView.vue'), props: { menu: true }, meta: { staff: true } },
    {
      path: '/overzicht',
      component: () => import('./views/overzicht/OverzichtLayout.vue'),
      meta: { staff: true },
      children: [
        { path: '', redirect: { name: 'kaart' } },
        { path: 'kaart', name: 'kaart', component: () => import('./views/overzicht/KaartView.vue'), meta: { staff: true } },
        { path: 'posten', name: 'posten', component: () => import('./views/overzicht/PostenTab.vue'), meta: { staff: true } },
        { path: 'verzoeken', name: 'verzoeken', component: () => import('./views/overzicht/VerzoekenTab.vue'), meta: { staff: true } },
        { path: 'contacten', name: 'contacten', component: () => import('./views/overzicht/ContactenTab.vue'), meta: { staff: true } },
      ],
    },
    { path: '/post/:id', name: 'post', component: () => import('./views/PostDetailView.vue'), props: true, meta: { staff: true } },
    { path: '/controle', name: 'controle', component: () => import('./views/ControleView.vue'), meta: { staff: true } },
    { path: '/deelnemer', name: 'deelnemer', component: () => import('./views/DeelnemerView.vue') },
    { path: '/beheer', name: 'beheer', component: () => import('./views/admin/BeheerView.vue'), meta: { staff: true, admin: true } },
    { path: '/beheer/evenement', name: 'beheer-evenement', component: () => import('./views/admin/EvenementView.vue'), meta: { staff: true, admin: true } },
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
  if (to.meta.staff && !session.me) return { name: 'welkom' };
  if (to.meta.admin && !session.me?.isAdmin) return { name: 'start' };
  // Aangemeld: het startscherm in plaats van de keuze medewerker of deelnemer.
  if (to.name === 'welkom' && session.me) return { name: 'start' };
  // Beheerders, kernteam en overige medewerkers beginnen in het overzicht (stand-by en post volgen in fase 3).
  if (to.name === 'start' && session.me?.home === 'overzicht') return { name: 'kaart' };
  // Medewerkers zetten de app eerst op het beginscherm.
  if (to.name === 'aanmelden' && !canUseAsStaff) return { name: 'installeren' };
});
