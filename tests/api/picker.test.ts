import { beforeAll, describe, expect, it } from "vitest";
import { apiClient } from "./client.ts";

const SECRET = "s".repeat(32);
let call: Awaited<ReturnType<typeof apiClient>>;
beforeAll(async () => {
  call = await apiClient([], {
    DIVVY_AUTH_MODE: "picker",
    DIVVY_SESSION_SECRET: SECRET,
  });
});

const cookieOf = (res: { headers: Headers }) =>
  res.headers.get("set-cookie")!.split(";")[0]!;
const as = (cookie: string) => ({ headers: { cookie } });

describe("picker mode", () => {
  it("redirects pages to /who and 401s the API without a pick", async () => {
    const page = await call("GET", "/groups");
    expect(page.status).toBe(302);
    expect(page.headers.get("location")).toBe("/who");
    expect(await call("GET", "/api/me")).toEqual({
      status: 401,
      body: { error: "Sign in required" },
    });
  });

  it("adds a new person, remembers them, and lets anyone pick them", async () => {
    const res = await call("POST", "/api/who", {
      body: { name: "Ana Ruiz", email: "Ana@Example.com" },
    });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      name: "Ana Ruiz",
      email: "ana@example.com",
    });
    expect(res.headers.get("set-cookie")).toMatch(
      /HttpOnly; SameSite=Lax; Max-Age=31536000$/,
    );
    const ana = cookieOf(res);
    expect((await call("GET", "/api/me", as(ana))).body.name).toBe("Ana Ruiz");

    expect(
      (
        await call("POST", "/api/who", {
          body: { name: "X", email: "ana@example.com" },
        })
      ).status,
    ).toBe(409);
    expect(
      (await call("POST", "/api/who", { body: { name: "X", email: "nope" } }))
        .body,
    ).toEqual({ error: "email: That doesn't look like an email address" });

    const picked = await call("POST", "/api/who", {
      body: { userId: res.body.id },
    });
    expect((await call("GET", "/api/me", as(cookieOf(picked)))).body.id).toBe(
      res.body.id,
    );
  });

  it("merges invited placeholders when someone new joins with that email", async () => {
    const ana = cookieOf(
      await call("POST", "/api/who", {
        body: { name: "Cy", email: "cy@example.com" },
      }),
    );
    const g = (
      await call("POST", "/api/groups", { ...as(ana), body: { name: "Flat" } })
    ).body;
    const dee = (
      await call("POST", `/api/groups/${g.id}/members`, {
        ...as(ana),
        body: { name: "Dee", email: "dee@example.com" },
      })
    ).body;
    const joined = await call("POST", "/api/who", {
      body: { name: "Deirdre", email: "dee@example.com" },
    });
    expect(joined.body).toMatchObject({ memberId: dee.id, name: "Deirdre" });
    const groups = await call("GET", "/api/groups", as(cookieOf(joined)));
    expect(groups.body.map((x: { name: string }) => x.name)).toEqual(["Flat"]);
  });

  it("rejects tampered, foreign and unknown-user cookies", async () => {
    const real = cookieOf(
      await call("POST", "/api/who", {
        body: { name: "Eli", email: "eli@example.com" },
      }),
    );
    const [, value] = real.split("=") as [string, string];
    const [id, mac] = decodeURIComponent(value).split(".") as [string, string];
    const tampered = `divvy_who=${Number(id) + 1}.${mac}`;
    expect((await call("GET", "/api/me", as(tampered))).status).toBe(401);
    const { signUserId } = await import("../../src/auth/picker.ts");
    const foreign = `divvy_who=${signUserId(Number(id), "x".repeat(32))}`;
    expect((await call("GET", "/api/me", as(foreign))).status).toBe(401);
    const unknown = `divvy_who=${signUserId(9999, SECRET)}`;
    expect((await call("GET", "/api/me", as(unknown))).status).toBe(401);
  });

  it("forgets the pick on switch", async () => {
    const res = await call("DELETE", "/api/who");
    expect(res.status).toBe(204);
    expect(res.headers.get("set-cookie")).toMatch(/^divvy_who=; .*Max-Age=0/);
  });
});
