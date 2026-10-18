import { useState } from "react";
import { api } from "../client/api.ts";
import { formatDate, todayLocal } from "../client/format.ts";
import { toast } from "../client/toast.ts";
import AttachmentUploader, { formatSize } from "./AttachmentUploader.tsx";
import { ConfirmButton } from "./ui.tsx";

interface Attachment {
  id: number;
  filename: string;
  label: string | null;
  mime: string;
  size: number;
  uploaderName: string;
  created: string;
  canRemove: boolean;
}

/** Thumbnails for images browsers show; an icon for PDFs and HEIC. */
function Preview({ a }: { a: Attachment }) {
  if (a.mime.startsWith("image/") && a.mime !== "image/heic")
    return (
      <img
        src={`/api/attachments/${a.id}`}
        alt=""
        className="h-14 w-14 shrink-0 rounded border border-line object-cover"
        loading="lazy"
      />
    );
  return (
    <span
      aria-hidden="true"
      className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-line text-xs font-semibold text-muted"
    >
      {a.mime === "application/pdf" ? "PDF" : "IMG"}
    </span>
  );
}

/** The expense's attachments: open, remove (if allowed), and add more (if you may edit it). */
export default function ExpenseAttachments({
  expenseId,
  canEdit,
  attachments: initial,
}: {
  expenseId: number;
  canEdit: boolean;
  attachments: Attachment[];
}) {
  const [items, setItems] = useState(initial);
  return (
    <section className="mt-6" aria-labelledby="attachments-h">
      <h2
        id="attachments-h"
        className="mb-2 text-sm font-semibold uppercase tracking-wide text-muted"
      >
        Attachments
      </h2>
      {items.length === 0 ? (
        <p className="card p-4 text-muted">No attachments yet.</p>
      ) : (
        <ul className="card divide-y divide-line" aria-label="Attachments">
          {items.map((a) => (
            <li key={a.id} className="space-y-2 px-4 py-3">
              <a
                href={`/api/attachments/${a.id}`}
                data-astro-prefetch="false"
                target="_blank"
                rel="noopener"
                className="flex items-center gap-3 hover:underline"
              >
                <Preview a={a} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {a.label || a.filename}
                  </span>
                  <span className="block truncate text-sm text-muted">
                    {a.label ? `${a.filename} · ` : ""}
                    {formatSize(a.size)} · {a.uploaderName} ·{" "}
                    {formatDate(todayLocal(new Date(a.created)))}
                  </span>
                </span>
              </a>
              <div className="flex flex-wrap gap-2">
                <a
                  href={`/api/attachments/${a.id}`}
                  data-astro-prefetch="false"
                  target="_blank"
                  rel="noopener"
                  className="btn btn-secondary px-3 text-sm"
                  aria-label={`Open ${a.label || a.filename}`}
                >
                  Open
                </a>
                <a
                  href={`/api/attachments/${a.id}?download=1`}
                  data-astro-reload
                  data-astro-prefetch="false"
                  download={a.filename}
                  className="btn btn-secondary px-3 text-sm"
                  aria-label={`Download ${a.label || a.filename}`}
                >
                  Download
                </a>
                {a.canRemove && (
                  <ConfirmButton
                    compact
                    className="ml-auto"
                    label="Remove"
                    name={`Remove ${a.label || a.filename}`}
                    question={`Remove ${a.label || a.filename} from this expense?`}
                    confirmLabel="Remove"
                    onConfirm={async () => {
                      await api("DELETE", `/api/attachments/${a.id}`);
                      setItems((xs) => xs.filter((x) => x.id !== a.id));
                      toast(`Removed ${a.label || a.filename}`);
                    }}
                  />
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <div className="card mt-3 p-4">
          <AttachmentUploader
            endpoint={`/api/expenses/${expenseId}/attachments`}
            onUploaded={(a) => {
              setItems((xs) => [
                ...xs,
                {
                  ...a,
                  uploaderName: "You",
                  created: new Date().toISOString(),
                  canRemove: true,
                },
              ]);
              toast(`Attached ${a.label || a.filename}`);
            }}
          />
        </div>
      )}
    </section>
  );
}
