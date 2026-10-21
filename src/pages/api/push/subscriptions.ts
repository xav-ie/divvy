import { route } from "../../../api/http.ts";
import { invalid } from "../../../services/errors.ts";
import { subscribe, unsubscribe } from "../../../services/notifications.ts";
import type { SubscriptionInput } from "../../../services/schemas.ts";

/** A browser PushSubscription's JSON: push the acting user's notifications to it. */
export const POST = route(({ ctx, body }) => {
  subscribe(ctx, body as SubscriptionInput);
});
/** `?endpoint=`: stop pushing to that device. */
export const DELETE = route(({ ctx, url }) => {
  const endpoint = url.searchParams.get("endpoint");
  if (!endpoint) throw invalid("Say which endpoint to remove");
  unsubscribe(ctx, endpoint);
});
