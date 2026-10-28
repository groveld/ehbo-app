// Afspraken tussen server en web: vorm van de API en van pushberichten.
export * from './phone.ts';
export * from './event.ts';
export * from './admin.ts';
export * from './package.ts';
export * from './geo.ts';

/** Push-abonnement zoals de browser het geeft (PushSubscription.toJSON()). */
export interface PushSubscriptionData {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** GET /api/info */
export interface AppInfo {
  version: string;
  commit: string;
  builtAt: string;
  vapidPublicKey: string;
  subscriptions: number;
}

/** POST /api/subscriptions */
export interface SubscribeRequest {
  subscription: PushSubscriptionData;
}

/** DELETE /api/subscriptions */
export interface UnsubscribeRequest {
  endpoint: string;
}

/** POST /api/test-push */
export interface TestPushRequest {
  endpoint: string;
  delaySeconds?: number;
}

export interface TestPushResponse {
  ok: true;
  scheduledInSeconds?: number;
}

/** Foutantwoord van elke API-route. */
export interface ApiError {
  error: string;
  detail?: string;
  gone?: boolean;
}

/** Inhoud van een pushbericht; de service worker maakt er een melding van. */
export interface PushPayload {
  title: string;
  body: string;
  tag?: string;
  url?: string;
  urgent?: boolean;
}

/** Maximale vertraging voor een testmelding, in seconden. */
export const TEST_PUSH_MAX_DELAY = 60;
