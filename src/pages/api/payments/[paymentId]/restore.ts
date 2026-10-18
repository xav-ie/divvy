import { route } from "../../../../api/http.ts";
import { restorePayment } from "../../../../services/payments.ts";

/** Undo a delete (within 7 days) -> the restored payment. */
export const POST = route(({ ctx, params }) =>
  restorePayment(ctx, Number(params.paymentId)),
);
