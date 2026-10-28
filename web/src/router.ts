import { createRouter, createWebHistory } from 'vue-router';
import { canUseAsStaff } from './platform.ts';
import { useSessionStore } from './stores/session.ts';

declare module 'vue-router' {
  interface RouteMeta {
    /** Alleen voor aangemelde medewerkers. */
    staff?: boolean;
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
    { path: '/controle', name: 'controle', component: () => import('./views/ControleView.vue'), meta: { staff: true } },
    { path: '/deelnemer', name: 'deelnemer', component: () => import('./views/DeelnemerView.vue') },
    { path: '/:pad(.*)*', redirect: '/' },
  ],
});

router.beforeEach((to) => {
  const session = useSessionStore();
  if (to.meta.staff && !session.me) return { name: 'welkom' };
  // Aangemeld: het startscherm in plaats van de keuze medewerker of deelnemer.
  if (to.name === 'welkom' && session.me) return { name: 'start' };
  // Medewerkers zetten de app eerst op het beginscherm.
  if (to.name === 'aanmelden' && !canUseAsStaff) return { name: 'installeren' };
});
