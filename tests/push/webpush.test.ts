import { importJWK, jwtVerify } from "jose";
import { describe, expect, it } from "vitest";
import {
  encrypt,
  generateVapidKeys,
  sendPush,
} from "../../src/push/webpush.ts";

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;
const b64u = (b: ArrayBuffer | Uint8Array) =>
  Buffer.from(b instanceof Uint8Array ? b : new Uint8Array(b)).toString(
    "base64url",
  );

/** A browser's side of a subscription: its ECDH key pair and auth secret. */
async function browser() {
  const pair = (await crypto.subtle.generateKey(P256, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = new Uint8Array(
    (await crypto.subtle.exportKey("raw", pair.publicKey)) as ArrayBuffer,
  );
  const auth = crypto.getRandomValues(new Uint8Array(16));
  return { pair, raw, auth, p256dh: b64u(raw), authB64: b64u(auth) };
}

const hkdf = async (
  salt: Uint8Array<ArrayBuffer>,
  ikm: ArrayBuffer | Uint8Array<ArrayBuffer>,
  info: string | Uint8Array<ArrayBuffer>,
  bytes: number,
) =>
  new Uint8Array(
    await crypto.subtle.deriveBits(
      {
        name: "HKDF",
        hash: "SHA-256",
        salt,
        info: typeof info === "string" ? new TextEncoder().encode(info) : info,
      },
      await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]),
      bytes * 8,
    ),
  );

/** Decrypt an aes128gcm body the way a browser does (RFC 8291 / 8188). */
async function decrypt(
  body: Uint8Array<ArrayBuffer>,
  ua: Awaited<ReturnType<typeof browser>>,
) {
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer).getUint32(16);
  const idlen = body[20]!;
  const asPublic = body.slice(21, 21 + idlen);
  const shared = await crypto.subtle.deriveBits(
    {
      name: "ECDH",
      public: await crypto.subtle.importKey("raw", asPublic, P256, false, []),
    },
    ua.pair.privateKey,
    256,
  );
  const info = new Uint8Array([
    ...new TextEncoder().encode("WebPush: info\0"),
    ...ua.raw,
    ...asPublic,
  ]);
  const ikm = await hkdf(ua.auth, shared, info, 32);
  const cek = await hkdf(salt, ikm, "Content-Encoding: aes128gcm\0", 16);
  const nonce = await hkdf(salt, ikm, "Content-Encoding: nonce\0", 12);
  const plain = new Uint8Array(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: nonce },
      await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]),
      body.slice(21 + idlen),
    ),
  );
  return {
    rs,
    idlen,
    delimiter: plain.at(-1),
    text: new TextDecoder().decode(plain.slice(0, -1)),
  };
}

describe("web push", () => {
  it("encrypts so only the subscribed browser can read it", async () => {
    const ua = await browser();
    const body = await encrypt(new TextEncoder().encode("hello, Ana"), {
      p256dh: ua.p256dh,
      auth: ua.authB64,
    });
    expect(await decrypt(body, ua)).toEqual({
      rs: 4096,
      idlen: 65,
      delimiter: 2,
      text: "hello, Ana",
    });
    const other = await browser();
    await expect(decrypt(body, other)).rejects.toThrow();
  });

  it("posts the encrypted message with a VAPID JWT for the push service's origin", async () => {
    const ua = await browser();
    const vapid = await generateVapidKeys();
    let sent: Request | undefined;
    const status = await sendPush(
      {
        endpoint: "https://push.example.com/send/abc",
        p256dh: ua.p256dh,
        auth: ua.authB64,
      },
      { title: "Hi" },
      vapid,
      "mailto:ana@example.com",
      (async (url: RequestInfo | URL, init?: RequestInit) => {
        sent = new Request(url, init);
        return new Response(null, { status: 201 });
      }) as typeof fetch,
    );
    expect(status).toBe(201);
    expect(sent!.url).toBe("https://push.example.com/send/abc");
    expect(sent!.headers.get("content-encoding")).toBe("aes128gcm");
    expect(sent!.headers.get("ttl")).toBe("86400");
    const m = /^vapid t=([^,]+), k=(.+)$/.exec(
      sent!.headers.get("authorization")!,
    )!;
    expect(m[2]).toBe(vapid.publicKey);
    const { x, y } = vapid.privateJwk;
    const { payload } = await jwtVerify(
      m[1]!,
      await importJWK({ kty: "EC", crv: "P-256", x, y }, "ES256"),
      { audience: "https://push.example.com" },
    );
    expect(payload.sub).toBe("mailto:ana@example.com");
    const body = new Uint8Array(await sent!.arrayBuffer());
    expect(JSON.parse((await decrypt(body, ua)).text)).toEqual({
      title: "Hi",
    });
  });
});
