import { importJWK, SignJWT, type JWK } from "jose";

/**
 * Web Push without a library: the payload is encrypted for the browser
 * (RFC 8291, `aes128gcm` from RFC 8188) and the request is signed with the
 * server's VAPID key (RFC 8292). Everything is WebCrypto plus jose for the JWT.
 */

type Bytes = Uint8Array<ArrayBuffer>;

const b64u = (bytes: Bytes | ArrayBuffer) =>
  Buffer.from(
    bytes instanceof ArrayBuffer ? new Uint8Array(bytes) : bytes,
  ).toString("base64url");
const unb64u = (s: string): Bytes =>
  new Uint8Array(Buffer.from(s, "base64url"));

export interface VapidKeys {
  /** Uncompressed P-256 public key, base64url: the browser's `applicationServerKey`. */
  publicKey: string;
  privateJwk: JWK;
}

/** Where a browser receives pushes and the keys to encrypt for it (base64url). */
export interface Target {
  endpoint: string;
  p256dh: string;
  auth: string;
}

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

export async function generateVapidKeys(): Promise<VapidKeys> {
  const pair = (await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  return {
    publicKey: b64u(
      (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
    ),
    privateJwk: (await crypto.subtle.exportKey("jwk", pair.privateKey)) as JWK,
  };
}

const hkdf = async (
  salt: Bytes,
  ikm: Bytes | ArrayBuffer,
  info: Bytes,
  bytes: number,
) =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt, info },
      await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
      bytes * 8,
    ),
  );

const text = (s: string): Bytes => new TextEncoder().encode(s);
const concat = (...parts: Bytes[]): Bytes => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** One `aes128gcm` record holding `payload`, encrypted for the browser's keys. */
export async function encrypt(
  payload: Bytes,
  target: Pick<Target, "p256dh" | "auth">,
  salt = crypto.getRandomValues(new Uint8Array(16)),
): Promise<Bytes> {
  const uaPublic = unb64u(target.p256dh);
  const local = (await crypto.subtle.generateKey(P256, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const asPublic = new Uint8Array(
    (await crypto.subtle.exportKey("raw", local.publicKey)) as ArrayBuffer,
  );
  const shared = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: await crypto.subtle.importKey("raw", uaPublic, P256, false, []),
    },
    local.privateKey,
    256,
  );
  const ikm = await hkdf(
    unb64u(target.auth),
    shared,
    concat(text("WebPush: info\0"), uaPublic, asPublic),
    32,
  );
  const cek = await hkdf(salt, ikm, text("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, text("Content-Encoding: nonce\0"), 12);
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: nonce },
    await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]),
    // 0x02 marks the last (only) record.
    concat(payload, new Uint8Array([2])),
  );
  const header = new Uint8Array(21);
  header.set(salt);
  new DataView(header.buffer).setUint32(16, 4096);
  header[20] = asPublic.length;
  return concat(header, asPublic, new Uint8Array(sealed));
}

/**
 * Send `message` (JSON) to one browser. Resolves to the push service's
 * status; 404 and 410 mean the subscription is gone for good.
 */
export async function sendPush(
  target: Target,
  message: unknown,
  vapid: VapidKeys,
  /** `mailto:` or `https:` contact the push service can reach about problems. */
  subject: string,
  fetchImpl: typeof fetch = fetch,
): Promise<number> {
  const jwt = await new SignJWT({ sub: subject })
    .setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setAudience(new URL(target.endpoint).origin)
    .setExpirationTime("12h")
    .sign(await importJWK(vapid.privateJwk, "ES256"));
  const body = await encrypt(text(JSON.stringify(message)), target);
  const res = await fetchImpl(target.endpoint, {
    method: "POST",
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`,
      "content-encoding": "aes128gcm",
      "content-type": "application/octet-stream",
      ttl: String(24 * 60 * 60),
      urgency: "normal",
    },
    body,
  });
  await res.body?.cancel();
  return res.status;
}
