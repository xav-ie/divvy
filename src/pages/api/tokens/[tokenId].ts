import { route } from "../../../api/http.ts";
import { revokeToken } from "../../../services/tokens.ts";

export const DELETE = route(({ ctx, params }) =>
  revokeToken(ctx, Number(params.tokenId)),
);
