import { uploadRoute } from "../../../api/http.ts";
import { uploadAttachment } from "../../../services/attachments.ts";

/** Upload before the expense exists; link it by sending `attachmentIds` when saving. */
export const POST = uploadRoute(({ ctx, upload }) =>
  uploadAttachment(ctx, upload),
);
