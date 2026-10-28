import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { encryptPayload, generateVapidKeys, sendPush, b64url } from '../src/webpush.ts';

// RFC 8291, bijlage A: officiële testvector.
test('aes128gcm-versleuteling komt exact overeen met RFC 8291 bijlage A', () => {
  const body = encryptPayload('When I grow up, I want to be a watermelon', {
    p256dh: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
    auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  }, {
    asKeys: { privateKey: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw' },
    salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  });
  assert.equal(b64url.encode(body),
    'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

// Ontsleutelen zoals een browser dat doet (RFC 8291 §3.4, vanuit de ontvanger).
function decrypt(body: Buffer, uaEcdh: crypto.ECDH, authSecret: Buffer) {
  const salt = body.subarray(0, 16);
  const idlen = body.readUInt8(20);
  const asPublic = body.subarray(21, 21 + idlen);
  const ciphertext = body.subarray(21 + idlen);
  const hmac = (k: crypto.BinaryLike, d: crypto.BinaryLike) => crypto.createHmac('sha256', k).update(d).digest();
  const ecdhSecret = uaEcdh.computeSecret(asPublic);
  const prkKey = hmac(authSecret, ecdhSecret);
  const ikm = hmac(prkKey, Buffer.concat([Buffer.from('WebPush: info\0'), uaEcdh.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0\x01')).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0\x01')).subarray(0, 12);
  const decipher = crypto.createDecipheriv('aes-128-gcm', cek, nonce);
  decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  assert.equal(plain.at(-1), 2, 'laatste byte moet het record-scheidingsteken 0x02 zijn');
  return plain.subarray(0, -1).toString();
}

test('sendPush levert een geldig ondertekend en ontsleutelbaar bericht af', async () => {
  const vapid = { ...generateVapidKeys(), subject: 'mailto:test@example.org' };
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const authSecret = crypto.randomBytes(16);

  let received: { headers: http.IncomingHttpHeaders; body: Buffer } | undefined;
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => { received = { headers: req.headers, body: Buffer.concat(chunks) }; res.writeHead(201); res.end(); });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/push/abc`;

  const result = await sendPush(
    { endpoint, keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(authSecret) } },
    { title: 'Test', body: 'Hallo' },
    vapid,
  );
  server.close();
  assert.ok(received);

  assert.equal(result.ok, true);
  assert.equal(received.headers['content-encoding'], 'aes128gcm');
  assert.equal(received.headers.urgency, 'high');
  assert.equal(received.headers.ttl, '60');

  // VAPID-handtekening controleren met de publieke sleutel.
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(String(received.headers.authorization));
  assert.ok(m, 'Authorization-header heeft het vapid-formaat');
  assert.equal(m[2], vapid.publicKey);
  const [h, p, s] = m[1]!.split('.') as [string, string, string];
  const pub = b64url.decode(vapid.publicKey);
  const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: b64url.encode(pub.subarray(1, 33)), y: b64url.encode(pub.subarray(33)) } });
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, b64url.decode(s)), 'handtekening klopt');
  const claims = JSON.parse(b64url.decode(p).toString());
  assert.equal(claims.aud, new URL(endpoint).origin);
  assert.equal(claims.sub, vapid.subject);

  assert.deepEqual(JSON.parse(decrypt(received.body, ua, authSecret)), { title: 'Test', body: 'Hallo' });
});

test('sendPush meldt een verlopen abonnement (410) als gone', async () => {
  const vapid = { ...generateVapidKeys(), subject: 'mailto:test@example.org' };
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const server = http.createServer((req, res) => { req.resume(); req.on('end', () => { res.writeHead(410); res.end('gone'); }); });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const result = await sendPush(
    { endpoint: `http://127.0.0.1:${(server.address() as AddressInfo).port}/x`, keys: { p256dh: b64url.encode(ua.getPublicKey()), auth: b64url.encode(crypto.randomBytes(16)) } },
    'x', vapid,
  );
  server.close();
  assert.equal(result.ok, false);
  assert.equal(result.gone, true);
});
