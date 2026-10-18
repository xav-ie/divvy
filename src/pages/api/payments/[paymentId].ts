import { route } from "../../../api/http.ts";
import { deletePayment } from "../../../services/payments.ts";

export const DELETE = route(({ ctx, params }) =>
  deletePayment(ctx, Number(params.paymentId)),
);
