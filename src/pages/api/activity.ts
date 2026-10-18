import { route } from "../../api/http.ts";
import { listActivity } from "../../services/activity.ts";

export const GET = route(({ ctx, url }) =>
  listActivity(ctx, {
    limit: Number(url.searchParams.get("limit")) || undefined,
  }),
);
