/**
 * Web Push helpers — full RFC 8291 (aes128gcm) payload encryption +
 * RFC 8292 (VAPID) JWT signing. All using WebCrypto so it runs on the
 * Vercel Edge runtime without any npm dependencies.
 *
 * Public API:
 *   - generateVapidJWT(audience, subject, vapidPubB64, vapidPrivB64) → JWT string
 *   - encryptPayload(payload: string|object, subscription: {keys:{p256dh,auth}}) →
 *       { body: Uint8Array, headers: { ... } }
 *   - sendPush(subscription, payload, vapidPub, vapidPriv, vapidSubject) →
 *       Response from the push service
 */

// ─── base64url helpers ───────────────────────────────────────────────
export function b64urlDecode(s) {
  const b = (s + '==='.slice((s.length + 3) % 4)).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(b);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
export function b64urlEncode(buf) {
  let s = '';
  const a = new Uint8Array(buf);
  for (let i = 0; i < a.length; i++) s += String.fromCharCode(a[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function concatBytes(...arrs) {
  let n = 0;
  for (const a of arrs) n += a.length;
  const out = new Uint8Array(n);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

// ─── VAPID JWT (ES256) ────────────────────────────────────────────────
export async function generateVapidJWT(audience, subject, vapidPubB64, vapidPrivB64) {
  const pub = b64urlDecode(vapidPubB64);
  const priv = b64urlDecode(vapidPrivB64);
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error('VAPID_PUBLIC_KEY must be 65-byte uncompressed point');
  if (priv.length !== 32) throw new Error('VAPID_PRIVATE_KEY must be 32 bytes');

  const jwk = {
    kty: 'EC', crv: 'P-256',
    x: b64urlEncode(pub.slice(1, 33)),
    y: b64urlEncode(pub.slice(33, 65)),
    d: b64urlEncode(priv),
    ext: true,
  };
  const key = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);

  const enc = new TextEncoder();
  const headerB64  = b64urlEncode(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const payloadB64 = b64urlEncode(enc.encode(JSON.stringify({
    aud: audience,
    exp: Math.floor(Date.now() / 1000) + 12 * 3600,
    sub: subject,
  })));
  const signingInput = headerB64 + '.' + payloadB64;
  const sigDer = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(signingInput));
  return signingInput + '.' + b64urlEncode(sigDer);
}

// ─── HKDF helper ──────────────────────────────────────────────────────
async function hkdfExtract(salt, ikm) {
  const key = await crypto.subtle.importKey('raw', salt, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const prk = await crypto.subtle.sign('HMAC', key, ikm);
  return new Uint8Array(prk);
}
async function hkdfExpand(prk, info, length) {
  // RFC 5869 — single block (length ≤ 32 bytes for SHA-256) is enough for our case
  const key = await crypto.subtle.importKey('raw', prk, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const t = await crypto.subtle.sign('HMAC', key, concatBytes(info, new Uint8Array([0x01])));
  return new Uint8Array(t).slice(0, length);
}

// ─── aes128gcm payload encryption (RFC 8291 + RFC 8188) ──────────────
export async function encryptPayload(payload, subscription) {
  const enc = new TextEncoder();
  const plain = typeof payload === 'string' ? enc.encode(payload) : enc.encode(JSON.stringify(payload));

  // Subscriber's keys
  const uaPublic = b64urlDecode(subscription.keys.p256dh);  // 65 bytes
  const authSecret = b64urlDecode(subscription.keys.auth);  // 16 bytes

  // Generate ephemeral ECDH keypair
  const localKp = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const localPubJwk = await crypto.subtle.exportKey('jwk', localKp.publicKey);
  const localPubRaw = await crypto.subtle.exportKey('raw', localKp.publicKey); // 65 bytes uncompressed

  // Import the UA public key
  const uaPubKey = await crypto.subtle.importKey(
    'raw', uaPublic,
    { name: 'ECDH', namedCurve: 'P-256' }, false, []
  );
  // ECDH shared secret
  const ecdhBits = await crypto.subtle.deriveBits({ name: 'ECDH', public: uaPubKey }, localKp.privateKey, 256);
  const ecdhSecret = new Uint8Array(ecdhBits);

  // Random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16));

  // Step 1: PRK_key = HKDF(authSecret, ecdhSecret, "WebPush: info\0" + uaPublic + localPub, 32)
  // Per RFC 8291 §3.4
  const keyInfo = concatBytes(
    enc.encode('WebPush: info\0'),
    uaPublic,
    new Uint8Array(localPubRaw),
  );
  const prkKey = await hkdfExtract(authSecret, ecdhSecret);
  const ikm = await hkdfExpand(prkKey, keyInfo, 32);

  // Step 2: Derive content encryption key + nonce per RFC 8188
  const prk = await hkdfExtract(salt, ikm);
  const cek   = await hkdfExpand(prk, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdfExpand(prk, enc.encode('Content-Encoding: nonce\0'), 12);

  // Step 3: Pad plaintext: plain || 0x02 (last record marker)
  const padded = concatBytes(plain, new Uint8Array([0x02]));

  // Step 4: AES-128-GCM encrypt
  const aesKey = await crypto.subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, aesKey, padded);

  // Step 5: Build aes128gcm payload header (RFC 8188 §2.1):
  //   salt(16) || rs(4 BE) || idlen(1) || keyid(idlen) || ciphertext
  const rs = 4096;  // record size
  const localPub = new Uint8Array(localPubRaw);
  const header = new Uint8Array(16 + 4 + 1 + localPub.length);
  header.set(salt, 0);
  // rs as big-endian uint32
  header[16] = (rs >>> 24) & 0xff;
  header[17] = (rs >>> 16) & 0xff;
  header[18] = (rs >>> 8) & 0xff;
  header[19] = rs & 0xff;
  header[20] = localPub.length;  // 65
  header.set(localPub, 21);

  const body = concatBytes(header, new Uint8Array(ct));

  return {
    body,
    headers: {
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(body.length),
    },
  };
}

// ─── High-level send ──────────────────────────────────────────────────
export async function sendPush(subscription, payload, vapidPub, vapidPriv, vapidSubject, opts = {}) {
  const url = new URL(subscription.endpoint);
  const audience = url.origin;
  const jwt = await generateVapidJWT(audience, vapidSubject, vapidPub, vapidPriv);

  let body, headers;
  if (payload != null && payload !== '') {
    const enc = await encryptPayload(payload, subscription);
    body = enc.body;
    headers = enc.headers;
  } else {
    body = null;
    headers = {};
  }

  headers['Authorization'] = `vapid t=${jwt}, k=${vapidPub}`;
  headers['TTL'] = String(opts.ttl ?? 86400);
  if (opts.urgency) headers['Urgency'] = opts.urgency;     // very-low | low | normal | high
  if (opts.topic)   headers['Topic']   = opts.topic;       // collapse key

  return await fetch(subscription.endpoint, {
    method: 'POST',
    headers,
    body,
  });
}
