// Pushmeldingen naar personen: elk toestel waarop iemand meldingen heeft aangezet.
import type { FastifyBaseLogger } from 'fastify';
import type { PushPayload, PushSubscriptionData } from '@ehbo/shared';
import type { EventDb } from './event-db.ts';
import { sendPush, type Vapid } from './webpush.ts';

export interface Notifier {
  /** Eén toestel; geeft het antwoord van de push-dienst terug. */
  pushTo(subscription: PushSubscriptionData, payload: PushPayload): ReturnType<typeof sendPush>;
  /** Alle toestellen van deze personen, op de achtergrond; een mislukte melding houdt de rest niet op. */
  toPhones(phones: Iterable<string>, payload: PushPayload): void;
}

export function createNotifier(db: EventDb, vapid: Vapid, log: FastifyBaseLogger): Notifier {
  async function pushTo(subscription: PushSubscriptionData, payload: PushPayload) {
    // Altijd hoge urgentie: met 'normal' houdt Android een melding vast zolang het toestel slaapt.
    // Een melding die na twee minuten nog niet is afgeleverd, is achterhaald.
    const result = await sendPush(subscription, payload, vapid, { ttl: 120, urgency: 'high' });
    db.markPush(subscription.endpoint, result.status);
    if (result.gone) db.deleteSubscription(subscription.endpoint);
    log.info({ status: result.status, host: new URL(subscription.endpoint).host, tag: payload.tag, detail: result.ok ? undefined : result.body }, 'push');
    return result;
  }

  return {
    pushTo,
    toPhones(phones, payload) {
      for (const phone of new Set(phones)) {
        for (const subscription of db.subscriptionsFor(phone)) {
          pushTo(subscription, payload).catch((err: Error) => log.error(err, 'push mislukt'));
        }
      }
    },
  };
}
