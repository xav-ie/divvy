import { route, uploadRoute } from "../../../../api/http.ts";
import {
  listAttachments,
  uploadAttachment,
} from "../../../../services/attachments.ts";

export const GET = route(({ ctx, params }) =>
  listAttachments(ctx, Number(params.expenseId)),
);
/** Multipart `file` and optional `label`; needs permission to edit the expense. */
export const POST = uploadRoute(({ ctx, params, upload }) =>
  uploadAttachment(ctx, upload, Number(params.expenseId)),
);
