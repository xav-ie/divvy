import { route } from "../../../api/http.ts";
import { personDrillDown } from "../../../services/balances.ts";

/** Drill-down with one person; `?groupId=` limits it to one group. */
export const GET = route(({ ctx, params, url }) => {
  const groupId = url.searchParams.get("groupId");
  return personDrillDown(
    ctx,
    Number(params.memberId),
    groupId === null ? undefined : Number(groupId),
  );
});
