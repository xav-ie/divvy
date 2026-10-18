import { z } from "zod";
import {
  listAttachments,
  MAX_ATTACHMENT_BYTES,
  removeAttachment,
  uploadAttachment,
  type AttachmentView,
} from "../services/attachments.ts";
import { invalid } from "../services/errors.ts";
import { handle, type Register } from "./tools.ts";

const out = (a: AttachmentView) => ({
  id: a.id,
  expenseId: a.expenseId,
  filename: a.filename,
  label: a.label,
  mime: a.mime,
  size: a.size,
  uploadedBy: a.uploaderName,
  created: a.created,
  url: `/api/attachments/${a.id}`,
  youCanRemove: a.canRemove,
});

export const registerAttachments: Register = (server, ctx) => {
  server.registerTool(
    "attach_document",
    {
      description:
        "Attach proof to an expense (a statement PDF or a photo: PDF, JPEG, PNG, WebP, GIF or HEIC, up to 20 MB), sent as base64. Needs permission to edit the expense. Confirm with the user first.",
      inputSchema: {
        expense_id: z.number().int(),
        filename: z
          .string()
          .describe("Original file name, e.g. eversource-oct.pdf"),
        content_base64: z.string().describe("The file's bytes, base64 encoded"),
        label: z
          .string()
          .optional()
          .describe('Short description, e.g. "Eversource statement"'),
      },
    },
    (a) =>
      handle(async () => {
        // Base64 is 4/3 the size: refuse before decoding something huge.
        if (
          a.content_base64.length >
          Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 4
        )
          throw invalid("That file is over 20 MB; try a smaller one");
        const bytes = new Uint8Array(Buffer.from(a.content_base64, "base64"));
        return {
          attachment: out(
            await uploadAttachment(
              ctx,
              { bytes, filename: a.filename, label: a.label ?? null },
              a.expense_id,
            ),
          ),
        };
      }),
  );

  server.registerTool(
    "list_attachments",
    {
      description:
        "An expense's attachments (proof such as statements and photos).",
      inputSchema: { expense_id: z.number().int() },
      annotations: { readOnlyHint: true },
    },
    ({ expense_id }) =>
      handle(() => ({
        attachments: listAttachments(ctx, expense_id).map(out),
      })),
  );

  server.registerTool(
    "remove_attachment",
    {
      description:
        "Remove an attachment from its expense (its uploader, or whoever may edit the expense). Confirm with the user first.",
      inputSchema: { attachment_id: z.number().int() },
      annotations: { destructiveHint: true },
    },
    ({ attachment_id }) =>
      handle(() => {
        removeAttachment(ctx, attachment_id);
        return { removed: attachment_id };
      }),
  );
};
