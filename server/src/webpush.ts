// Web Push zonder externe pakketten: VAPID (RFC 8292) en aes128gcm-versleuteling (RFC 8291 / RFC 8188).
import crypto from 'node:crypto';
import type { PushSubscriptionData } from '@ehbo/shared';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export interface Vapid extends VapidKeys {
  subject: string;
}

export interface PushResult {
  ok: boolean;
  status: number;
  /** Abonnement bestaat niet meer en moet weg. */
  gone: boolean;
  body: string;
}

export const b64url = {
  encode: (buf: Uint8Array | string) => Buffer.from(buf).toString('base64url'),
  decode: (str: string) => Buffer.from(str, 'base64url'),
};

/** Nieuwe VAPID-sleutels (P-256). publicKey = 65 bytes ongecomprimeerd, privateKey = 32 bytes, beide base64url. */
export function generateVapidKeys(): VapidKeys {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64url.encode(ecdh.getPublicKey()), privateKey: b64url.encode(ecdh.getPrivateKey()) };
}

function privateKeyObject(publicKeyB64: string, privateKeyB64: string) {
  const pub = b64url.decode(publicKeyB64);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID public key moet 65 bytes ongecomprimeerd zijn');
  return crypto.createPrivateKey({
    format: 'jwk',
    key: { kty: 'EC', crv: 'P-256', d: privateKeyB64, x: b64url.encode(pub.subarray(1, 33)), y: b64url.encode(pub.subarray(33, 65)) },
  });
}

/** Maakt de Authorization-header voor een push-endpoint. */
export function vapidAuthorization(endpoint: string, { publicKey, privateKey, subject }: Vapid, expiresInSeconds = 12 * 3600) {
  const aud = new URL(endpoint).origin;
  const header = b64url.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const payload = b64url.encode(JSON.stringify({ aud, exp: Math.floor(Date.now() / 1000) + expiresInSeconds, sub: subject }));
  const data = `${header}.${payload}`;
  const signature = crypto.sign('sha256', Buffer.from(data), { key: privateKeyObject(publicKey, privateKey), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${data}.${b64url.encode(signature)}, k=${publicKey}`;
}

const hmac = (key: crypto.BinaryLike, data: Buffer | string) => crypto.createHmac('sha256', key).update(data).digest();

/**
 * Versleutelt een bericht voor één abonnement (één record, aes128gcm).
 * `asKeys` en `salt` zijn alleen bedoeld voor tests met vaste waarden.
 */
export function encryptPayload(
  plaintext: string,
  { p256dh, auth }: PushSubscriptionData['keys'],
  { asKeys, salt }: { asKeys?: { privateKey: string }; salt?: string } = {},
) {
  const uaPublic = b64url.decode(p256dh);
  const authSecret = b64url.decode(auth);
  if (uaPublic.length !== 65) throw new Error('p256dh moet 65 bytes zijn');
  if (authSecret.length !== 16) throw new Error('auth moet 16 bytes zijn');

  const ecdh = crypto.createECDH('prime256v1');
  if (asKeys) ecdh.setPrivateKey(b64url.decode(asKeys.privateKey));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // RFC 8291 §3.4
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));

  // RFC 8188 §2.2 en §2.3
  const saltBuf = salt ? b64url.decode(salt) : crypto.randomBytes(16);
  const prk = hmac(saltBuf, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);

  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const padded = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]); // 0x02 = laatste record
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const recordSize = 4096;
  if (padded.length + 16 > recordSize) throw new Error('Bericht te groot voor één push-record');
  const header = Buffer.alloc(16 + 4 + 1);
  saltBuf.copy(header, 0);
  header.writeUInt32BE(recordSize, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, ciphertext]);
}

/** Stuurt een pushbericht naar de push-dienst van het abonnement. */
export async function sendPush(
  subscription: PushSubscriptionData,
  payload: string | object,
  vapid: Vapid,
  { ttl = 60, urgency = 'high', topic }: { ttl?: number; urgency?: 'very-low' | 'low' | 'normal' | 'high'; topic?: string } = {},
): Promise<PushResult> {
  const body = encryptPayload(typeof payload === 'string' ? payload : JSON.stringify(payload), subscription.keys);
  const headers: Record<string, string> = {
    TTL: String(ttl),
    Urgency: urgency,
    'Content-Encoding': 'aes128gcm',
    'Content-Type': 'application/octet-stream',
    'Content-Length': String(body.length),
    Authorization: vapidAuthorization(subscription.endpoint, vapid),
  };
  if (topic) headers.Topic = topic;
  const res = await fetch(subscription.endpoint, { method: 'POST', headers, body });
  const text = await res.text().catch(() => '');
  return { ok: res.status >= 200 && res.status < 300, status: res.status, gone: res.status === 404 || res.status === 410, body: text.slice(0, 500) };
}
