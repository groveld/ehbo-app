// The call or request you're part of, for the bar above the tab bar: from any page you're one tap away from it, should it get worse.
// Only for those who need it: the EHBO team on a call, and the post that asked for help. The coordinator has the Meldingen tab.
import { computed } from 'vue';
import { useRoute, type RouteLocationRaw } from 'vue-router';
import type { LiveIncident } from '@ehbo/shared';
import { clock, incidentSummary, postOf, travelMinutes, unitOf } from '../incidents.ts';
import { useLiveStore } from '../stores/live.ts';
import { usePackageStore } from '../stores/package.ts';
import { useSessionStore } from '../stores/session.ts';

export interface LiveBar {
  tone: 'red' | 'orange' | 'green';
  title: string;
  sub: string;
  to: RouteLocationRaw;
  /** Other open calls of this post. */
  more: number;
}

export function useLiveBar() {
  const route = useRoute();
  const live = useLiveStore();
  const store = usePackageStore();
  const session = useSessionStore();

  const onScreen = (incidentId: number) => {
    const param = Number(route.params.id ?? route.params.incidentId);
    return ['melding', 'oproep', 'afronden', 'inzet', 'aanvullen'].includes(String(route.name)) && live.incidentById(param)?.id === incidentId;
  };

  function teamBar(incident: LiveIncident): LiveBar {
    const name = postOf(store.postById, incident).name;
    if (incident.status === 'ter_plaatse') {
      return { tone: 'red', title: `Ter plaatse · ${name}`, sub: 'Tik om af te ronden', to: { name: 'afronden', params: { id: incident.id } }, more: 0 };
    }
    const since = incident.dispatches.find((d) => live.myUnitIds.includes(d.unitId))?.acceptedAt;
    return { tone: 'red', title: `Onderweg · ${name}`, sub: `${incidentSummary(incident)} · sinds ${clock(since)}`, to: { name: 'oproep', params: { id: incident.id } }, more: 0 };
  }

  function postBar(incident: LiveIncident, more: number): LiveBar {
    const to: RouteLocationRaw = more ? { name: 'post-home', params: { id: incident.postId } } : { name: 'melding', params: { id: incident.id } };
    const last = live.offline ? 'Laatst bekende stand' : null;
    if (incident.status === 'verstuurd') {
      const left = live.secondsLeft(incident);
      return { tone: 'orange', title: "We zoeken een EHBO'er", sub: last ?? (left !== null ? `Nog ${left} s tot alle eenheden` : 'Alle eenheden zijn opgeroepen'), to, more };
    }
    const unit = unitOf(store.pkg, incident.unitId);
    const helper = [incident.acceptedBy?.name, unit ? `EHBO ${unit.name}` : null].filter(Boolean).join(' · ');
    if (incident.status === 'ter_plaatse') return { tone: 'green', title: 'EHBO is er', sub: last ?? `${helper} · sinds ${clock(incident.onSiteAt)}`, to, more };
    const minutes = travelMinutes(incident.dispatches.find((d) => d.unitId === incident.unitId)?.distanceKm ?? null, unit);
    return { tone: 'green', title: `Hulp is onderweg${minutes ? ` · ± ${minutes} min` : ''}`, sub: last ?? helper, to, more };
  }

  return computed<LiveBar | null>(() => {
    if (live.myActive) return onScreen(live.myActive.id) ? null : teamBar(live.myActive);
    const mine = live.openIncidents.filter((i) => (live.myPostIds.includes(i.postId) && !i.offPost) || i.reportedBy === session.me?.phone);
    const [newest] = mine;
    if (newest) return mine.some((i) => onScreen(i.id)) ? null : postBar(newest, mine.length - 1);
    // Sent without signal: it isn't an incident yet, and this screen says who to call.
    const waiting = live.outbox.at(-1);
    if (!waiting || route.params.clientId === waiting.clientId) return null;
    return {
      tone: 'orange', title: 'Melding wacht op bereik', sub: store.postById.get(waiting.postId)?.name ?? 'Tik om de EHBO te bellen',
      to: { name: 'geen-bereik', params: { clientId: waiting.clientId } }, more: live.outbox.length - 1,
    };
  });
}
