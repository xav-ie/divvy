import { route } from "../../../api/http.ts";
import type { TokenInput } from "../../../services/schemas.ts";
import { createToken, listTokens } from "../../../services/tokens.ts";

export const GET = route(({ ctx }) => listTokens(ctx));
/** `{ name }` -> the token with its plaintext `token`, shown only this once. */
export const POST = route(({ ctx, body }) =>
  createToken(ctx, body as TokenInput),
);
