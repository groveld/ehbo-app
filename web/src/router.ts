import { createRouter, createWebHistory } from 'vue-router';
import { canUseAsStaff } from './platform.ts';
import { useSessionStore } from './stores/session.ts';

/** EHBO'ers naar het EHBO-scherm, wie bij een post staat naar die post (als verantwoordelijke eerst), de rest naar de kaart. */
export function homeRoute() {
  const session = useSessionStore();
  const me = session.me!;
  if (me.home === 'first_aid') return { name: 'first-aid' };
  if (me.home === 'location') {
    const location = me.assignments.find((a) => a.kind === 'location' && a.role === 'lead') ?? me.assignments.find((a) => a.kind === 'location');
    if (location?.locationId) return { name: 'location-home', params: { id: location.locationId } };
  }
  return { name: 'map' };
}

declare module 'vue-router' {
  interface RouteMeta {
    /** Alleen voor aangemelde medewerkers. */
    staff?: boolean;
    /** Alleen voor beheerders. */
    admin?: boolean;
  }
}

/** How far each page was scrolled: going to a page shows it as you left it, or from the top. */
const scrolled = new Map<string, number>();

export const router = createRouter({
  history: createWebHistory(),
  scrollBehavior: (to) => ({ top: scrolled.get(to.fullPath) ?? 0 }),
  routes: [
    // Zonder aanmelding opent de app op de deelnemerspagina; daar kun je je als medewerker aanmelden.
    { path: '/', name: 'participant', component: () => import('./views/ParticipantView.vue') },
    { path: '/install', name: 'install', component: () => import('./views/InstallView.vue') },
    { path: '/login', name: 'login', component: () => import('./views/LoginView.vue') },
    { path: '/unknown', name: 'unknown', component: () => import('./views/UnknownView.vue') },
    { path: '/recognized', name: 'recognized', component: () => import('./views/RecognizedView.vue'), meta: { staff: true } },
    { path: '/info', name: 'info', component: () => import('./views/InfoView.vue') },
    { path: '/route/:id', name: 'route', component: () => import('./views/RouteView.vue'), props: true },
    { path: '/permissions', name: 'permissions', component: () => import('./views/PermissionsView.vue'), meta: { staff: true } },
    // /start stuurt altijd door naar het startscherm van je rol (zie beforeEach).
    { path: '/start', name: 'start', component: () => import('./views/MenuView.vue'), meta: { staff: true } },
    { path: '/menu', name: 'menu', component: () => import('./views/MenuView.vue'), meta: { staff: true } },
    // Overzicht: de tabs van de tabbalk. De postenlijst staat onder de kaart.
    // The map itself stays mounted in App.vue, so it's there at once.
    { path: '/map', name: 'map', component: { render: () => null }, meta: { staff: true } },
    { path: '/requests', name: 'requests', component: () => import('./views/tabs/RequestsTab.vue'), meta: { staff: true } },
    { path: '/contacts', name: 'contacts', component: () => import('./views/tabs/ContactsTab.vue'), meta: { staff: true } },
    { path: '/location/:id', name: 'location', component: () => import('./views/LocationDetailView.vue'), props: true, meta: { staff: true } },
    // Post: startscherm (3.1/3.2), EHBO-verzoek (4.1) en de melding daarna (4.2/4.6).
    { path: '/location/:id/start', name: 'location-home', component: () => import('./views/LocationHomeView.vue'), props: true, meta: { staff: true } },
    // Eerder vandaag, met de melding of aanvraag eronder: de terugknop blijft in deze groep.
    { path: '/location/:id/history', name: 'location-history', component: () => import('./views/LocationHistoryView.vue'), props: true, meta: { staff: true } },
    { path: '/location/:locationId/history/incident/:id', name: 'location-incident', component: () => import('./views/IncidentView.vue'), props: (r) => ({ id: r.params.id }), meta: { staff: true } },
    { path: '/location/:locationId/history/request/:id', name: 'location-request', component: () => import('./views/RequestView.vue'), props: (r) => ({ id: r.params.id }), meta: { staff: true } },
    { path: '/help', name: 'help', component: () => import('./views/NewIncidentView.vue'), meta: { staff: true } },
    { path: '/location/:id/first-aid', name: 'new-incident', component: () => import('./views/NewIncidentView.vue'), props: true, meta: { staff: true } },
    { path: '/incident/:id', name: 'incident', component: () => import('./views/IncidentView.vue'), props: true, meta: { staff: true } },
    { path: '/request/:id', name: 'request', component: () => import('./views/RequestView.vue'), props: true, meta: { staff: true } },
    { path: '/no-signal/:clientId', name: 'no-signal', component: () => import('./views/NoSignalView.vue'), props: true, meta: { staff: true } },
    { path: '/incident/:incidentId/add', name: 'add-to-incident', component: () => import('./views/NewIncidentView.vue'), props: true, meta: { staff: true } },
    // EHBO: het EHBO-scherm (3.3) met je inzetten, oproep (4.3–4.7) en afronden (4.8).
    { path: '/first-aid', name: 'first-aid', component: () => import('./views/FirstAidView.vue'), meta: { staff: true } },
    { path: '/first-aid/incident', name: 'self-start', component: () => import('./views/SelfStartView.vue'), meta: { staff: true } },
    { path: '/first-aid/assign', name: 'assign', component: () => import('./views/AssignView.vue'), meta: { staff: true } },
    { path: '/first-aid/assign/:id', name: 'assign-incident', component: () => import('./views/IncidentView.vue'), props: true, meta: { staff: true } },
    { path: '/dispatch/:id', name: 'dispatch', component: () => import('./views/DispatchView.vue'), props: true, meta: { staff: true } },
    { path: '/dispatch/:id/close', name: 'close-incident', component: () => import('./views/CloseIncidentView.vue'), props: true, meta: { staff: true } },
    { path: '/control', name: 'control', component: () => import('./views/ControlView.vue'), meta: { staff: true } },
    { path: '/check', name: 'check', component: () => import('./views/CheckView.vue'), meta: { staff: true } },
    { path: '/admin', name: 'admin', component: () => import('./views/admin/AdminView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/event', name: 'admin-event', component: () => import('./views/admin/EventView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/info', name: 'admin-info', component: () => import('./views/admin/InfoEditView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/import', name: 'admin-import', component: () => import('./views/admin/ImportView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/people', name: 'admin-people', component: () => import('./views/admin/PeopleView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/core-team', name: 'admin-core-team', component: () => import('./views/admin/CoreTeamView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/emergency-numbers', name: 'admin-emergency-numbers', component: () => import('./views/admin/EmergencyNumbersView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/admins', name: 'admin-admins', component: () => import('./views/admin/AdminsView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/report', name: 'admin-report', component: () => import('./views/admin/ReportView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/report/print', name: 'admin-report-print', component: () => import('./views/admin/ReportPrintView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/app-icon', name: 'admin-app-icon', component: () => import('./views/admin/AppIconView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/runs/:id', name: 'admin-run', component: () => import('./views/admin/RunView.vue'), props: true, meta: { staff: true, admin: true } },
    { path: '/admin/locations', name: 'admin-locations', component: () => import('./views/admin/LocationsView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/locations/:id', name: 'admin-location', component: () => import('./views/admin/LocationView.vue'), props: true, meta: { staff: true, admin: true } },
    { path: '/admin/zones', name: 'admin-zones', component: () => import('./views/admin/ZonesView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/zones/:id', name: 'admin-zone', component: () => import('./views/admin/ZoneView.vue'), props: true, meta: { staff: true, admin: true } },
    { path: '/admin/teams', name: 'admin-teams', component: () => import('./views/admin/TeamsView.vue'), meta: { staff: true, admin: true } },
    { path: '/admin/teams/:id', name: 'admin-team', component: () => import('./views/admin/TeamView.vue'), props: true, meta: { staff: true, admin: true } },
    { path: '/:path(.*)*', redirect: '/' },
  ],
});

// A new version removed the file of a screen this page still wanted: load the new version. Once, so it can't loop.
router.onError((err, to) => {
  if (!/module|import/i.test((err as Error).message) || sessionStorage.getItem('app.reloaded') === to.fullPath) return;
  sessionStorage.setItem('app.reloaded', to.fullPath);
  location.assign(to.fullPath);
});

router.beforeEach((_to, from) => {
  scrolled.set(from.fullPath, window.scrollY);
});

router.beforeEach((to) => {
  const session = useSessionStore();
  if (to.meta.staff && !session.me) return { name: 'participant' };
  if (to.meta.admin && !session.me?.isAdmin) return { name: 'start' };
  // Aangemeld: het startscherm in plaats van de deelnemerspagina.
  if (to.name === 'participant' && session.me) return { name: 'start' };
  // Startscherm volgens de belangrijkste rol: EHBO, de eigen post, of het overzicht.
  if (to.name === 'start' && session.me) return homeRoute();
  // Medewerkers zetten de app eerst op het beginscherm.
  if (to.name === 'login' && !canUseAsStaff) return { name: 'install' };
});
