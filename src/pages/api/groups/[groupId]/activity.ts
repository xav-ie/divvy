import { route } from "../../../../api/http.ts";
import { listActivity } from "../../../../services/activity.ts";

export const GET = route(({ ctx, params, url }) =>
  listActivity(ctx, {
    groupId: Number(params.groupId),
    limit: Number(url.searchParams.get("limit")) || undefined,
  }),
);
