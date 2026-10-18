import { route } from "../../../api/http.ts";
import { homeSummary } from "../../../services/balances.ts";

export const GET = route(({ ctx }) => homeSummary(ctx));
