import { route } from "../../../../api/http.ts";
import { listPayments, recordPayment } from "../../../../services/payments.ts";
import type { PaymentInput } from "../../../../services/schemas.ts";

export const GET = route(({ ctx, params }) =>
  listPayments(ctx, Number(params.groupId)),
);
export const POST = route(({ ctx, params, body }) =>
  recordPayment(ctx, Number(params.groupId), body as PaymentInput),
);
