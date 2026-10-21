import { afterEach, describe, expect, it, vi } from "vitest";
import { all } from "../../src/db/rows.ts";
import { createExpense } from "../../src/services/expenses.ts";
import { createGroup } from "../../src/services/groups.ts";
import { addMember } from "../../src/services/members.ts";
import {
  getPushSettings,
  pushesSettled,
  subscribe,
  unsubscribe,
  updateNotifyPrefs,
} from "../../src/services/notifications.ts";
import { recordPayment } from "../../src/services/payments.ts";
import { ServiceError } from "../../src/services/errors.ts";
import { setup, simpleExpense, type Setup } from "../helpers.ts";

const P256 = { name: "ECDH", namedCurve: "P-256" } as const;

/** A real browser key pair, so encryption works end to end. */
async function device(endpoint: string) {
  const pair = (await crypto.subtle.generateKey(P256, true, [
    "deriveBits",
  ])) as CryptoKeyPair;
  const raw = (await crypto.subtle.exportKey(
    "raw",
    pair.publicKey,
  )) as ArrayBuffer;
  return {
    endpoint,
    keys: {
      p256dh: Buffer.from(raw).toString("base64url"),
      auth: Buffer.from(crypto.getRandomValues(new Uint8Array(16))).toString(
        "base64url",
      ),
    },
  };
}

/** Answer every push with `status`, recording where each went. */
function pushService(status = 201) {
  const sent: string[] = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    sent.push(String(input instanceof Request ? input.url : input));
    return new Response(null, { status });
  });
  return sent;
}

async function house({ db, as }: Setup) {
  const ana = as("ana@example.com");
  const ben = as("ben@example.com");
  const cy = as("cy@example.com");
  const group = createGroup(ana, { name: "House", emoji: "🏠" });
  addMember(ana, group.id, { email: "ben@example.com" });
  addMember(ana, group.id, { email: "cy@example.com" });
  subscribe(ana, await device("https://push.example.com/ana"));
  subscribe(ben, await device("https://push.example.com/ben"));
  subscribe(cy, await device("https://push.example.com/cy"));
  return { db, ana, ben, cy, group };
}

const endpoints = (db: Setup["db"]) =>
  all<{ endpoint: string }>(db, "SELECT endpoint FROM push_subscriptions").map(
    (r) => r.endpoint,
  );

afterEach(() => vi.restoreAllMocks());

describe("push notifications", () => {
  it("tells everyone else on a new expense, not whoever added it or people not on it", () =>
    setup(async (t) => {
      const { ana, ben, group } = await house(t);
      const sent = pushService();
      createExpense(
        ana,
        group.id,
        simpleExpense("Groceries", 3000, ana.user.memberId, [
          ana.user.memberId,
          ben.user.memberId,
        ]),
      );
      await pushesSettled();
      expect(sent).toEqual(["https://push.example.com/ben"]);
    }));

  it("tells the other person in a payment, and honors each user's switches", () =>
    setup(async (t) => {
      const { ana, ben, cy, group } = await house(t);
      const sent = pushService();
      const pay = () =>
        recordPayment(cy, group.id, {
          fromMember: ana.user.memberId,
          toMember: ben.user.memberId,
          cents: 500,
          date: "2026-01-02",
        });
      pay();
      await pushesSettled();
      expect(sent.sort()).toEqual([
        "https://push.example.com/ana",
        "https://push.example.com/ben",
      ]);

      expect(updateNotifyPrefs(ben, { payments: false })).toEqual({
        expenses: true,
        payments: false,
      });
      sent.length = 0;
      pay();
      await pushesSettled();
      expect(sent).toEqual(["https://push.example.com/ana"]);
      expect(await getPushSettings(ben)).toMatchObject({
        expenses: true,
        payments: false,
        publicKey: expect.stringMatching(/^[\w-]{87}$/),
      });
    }));

  it("forgets subscriptions the push service says are gone, and only lets owners remove theirs", () =>
    setup(async (t) => {
      const { db, ana, ben, group } = await house(t);
      unsubscribe(ana, "https://push.example.com/ben");
      expect(endpoints(db)).toContain("https://push.example.com/ben");
      pushService(410);
      createExpense(
        ana,
        group.id,
        simpleExpense("Rent", 100000, ana.user.memberId, [
          ana.user.memberId,
          ben.user.memberId,
        ]),
      );
      await pushesSettled();
      expect(endpoints(db).sort()).toEqual([
        "https://push.example.com/ana",
        "https://push.example.com/cy",
      ]);
      unsubscribe(ana, "https://push.example.com/ana");
      expect(endpoints(db)).toEqual(["https://push.example.com/cy"]);
    }));

  it("rejects subscriptions that aren't https push endpoints", () =>
    setup(async ({ as }) => {
      const ana = as("ana@example.com");
      const bad = await device("http://push.example.com/x");
      expect(() => subscribe(ana, bad)).toThrow(ServiceError);
      expect(() => updateNotifyPrefs(ana, {})).toThrow(ServiceError);
    }));
});
