import { route } from "../../../api/http.ts";
import {
  getPushSettings,
  updateNotifyPrefs,
} from "../../../services/notifications.ts";
import type { NotifyInput } from "../../../services/schemas.ts";

/** `{ publicKey, expenses, payments }`: the key to subscribe with and what the acting user wants pushed. */
export const GET = route(({ ctx }) => getPushSettings(ctx));
/** `{ expenses?, payments? }` -> the saved preferences, for all of the user's devices. */
export const PATCH = route(({ ctx, body }) =>
  updateNotifyPrefs(ctx, body as NotifyInput),
);
