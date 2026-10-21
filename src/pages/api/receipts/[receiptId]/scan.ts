import { route } from "../../../../api/http.ts";
import { scanKept } from "../../../../services/receipts.ts";

/** Read a receipt divvy already keeps (a photo shared to the app); same result as /api/receipts/scan. */
export const POST = route(({ ctx, params }) =>
  scanKept(ctx, Number(params.receiptId)),
);
