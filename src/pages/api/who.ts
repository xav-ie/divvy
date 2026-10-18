import type { APIRoute } from "astro";
import { json } from "../../api/http.ts";
import { pickerCookie } from "../../auth/picker.ts";
import { getDb } from "../../db/connection.ts";
import { getUser } from "../../db/users.ts";
import { ServiceError } from "../../services/errors.ts";
import { addNewPerson } from "../../services/users.ts";

/**
 * Picker mode only. POST `{ userId }` picks an existing person, POST
 * `{ name, email }` adds a new one; both set the signed cookie and return the
 * user. DELETE forgets the pick ("Switch person", sign out).
 */
export const POST: APIRoute = async ({ locals, request }) => {
  if (locals.auth.mode !== "picker") return json({ error: "Not found" }, 404);
  const body = (await request.json().catch(() => null)) as {
    userId?: unknown;
    name?: unknown;
    email?: unknown;
  } | null;
  const db = getDb();
  try {
    const user =
      body?.userId !== undefined
        ? getUser(db, Number(body.userId))
        : addNewPerson(db, body as { name: string; email: string });
    if (!user) return json({ error: "That person isn't here anymore" }, 404);
    const res = json(user);
    res.headers.append(
      "set-cookie",
      pickerCookie(request, user.id, locals.auth.secret),
    );
    return res;
  } catch (err) {
    if (err instanceof ServiceError)
      return json({ error: err.message }, err.status);
    throw err;
  }
};

export const DELETE: APIRoute = ({ locals, request }) => {
  if (locals.auth.mode !== "picker") return json({ error: "Not found" }, 404);
  const res = new Response(null, { status: 204 });
  res.headers.append("set-cookie", pickerCookie(request, null, ""));
  return res;
};
