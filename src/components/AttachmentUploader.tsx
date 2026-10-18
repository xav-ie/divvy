import { useId, useState } from "react";
import { ErrorText, Field } from "./ui.tsx";

export interface UploadedAttachment {
  id: number;
  filename: string;
  label: string | null;
  mime: string;
  size: number;
}

interface Pending {
  key: string;
  name: string;
  /** 0..1 */
  progress: number;
  error?: string;
}

/** POST one file with progress (fetch can't report upload progress). */
function send(
  endpoint: string,
  file: File,
  label: string,
  onProgress: (p: number) => void,
): Promise<UploadedAttachment> {
  return new Promise((resolve, reject) => {
    const form = new FormData();
    form.set("file", file);
    if (label.trim()) form.set("label", label.trim());
    const xhr = new XMLHttpRequest();
    xhr.open("POST", endpoint);
    xhr.upload.onprogress = (e) =>
      e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () =>
      reject(new Error("Couldn't reach the server. Check your connection."));
    xhr.onload = () => {
      let body: { error?: string } & Partial<UploadedAttachment> = {};
      try {
        body = JSON.parse(xhr.responseText);
      } catch {
        // handled below
      }
      if (xhr.status >= 200 && xhr.status < 300 && body.id)
        resolve(body as UploadedAttachment);
      else reject(new Error(body.error ?? `Upload failed (${xhr.status})`));
    };
    xhr.send(form);
  });
}

export const formatSize = (bytes: number) =>
  bytes < 1024 * 1024
    ? `${Math.max(1, Math.round(bytes / 1024))} KB`
    : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Pick PDFs or photos (the camera too, on phones), with an optional label,
 * uploaded one by one to `endpoint` with progress and inline errors.
 */
export default function AttachmentUploader({
  endpoint,
  onUploaded,
}: {
  endpoint: string;
  onUploaded: (a: UploadedAttachment) => void;
}) {
  const inputId = useId();
  const [label, setLabel] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const update = (key: string, patch: Partial<Pending>) =>
    setPending((ps) => ps.map((p) => (p.key === key ? { ...p, ...patch } : p)));

  async function upload(files: FileList) {
    const batch = [...files].map((f, i) => ({
      file: f,
      key: `${Date.now()}-${i}-${f.name}`,
    }));
    setPending((ps) => [
      ...ps,
      ...batch.map(({ file, key }) => ({ key, name: file.name, progress: 0 })),
    ]);
    for (const { file, key } of batch) {
      try {
        const a = await send(endpoint, file, label, (progress) =>
          update(key, { progress }),
        );
        setPending((ps) => ps.filter((p) => p.key !== key));
        onUploaded(a);
      } catch (err) {
        update(key, { error: (err as Error).message });
      }
    }
    setLabel("");
  }

  return (
    <div className="space-y-3">
      <Field
        label="Label (optional)"
        value={label}
        maxLength={100}
        placeholder="e.g. Eversource statement"
        onChange={(e) => setLabel(e.target.value)}
      />
      <label
        htmlFor={inputId}
        className="btn btn-secondary w-full cursor-pointer"
      >
        Attach PDF or photo
        <input
          id={inputId}
          type="file"
          className="sr-only"
          accept="image/*,application/pdf"
          multiple
          onChange={(e) => {
            if (e.target.files?.length) void upload(e.target.files);
            e.target.value = "";
          }}
        />
      </label>
      {pending.length > 0 && (
        <ul className="space-y-2" aria-label="Uploads">
          {pending.map((p) => (
            <li key={p.key} className="text-sm">
              <span className="break-all">{p.name}</span>
              {p.error ? (
                <ErrorText>{`${p.name}: ${p.error}`}</ErrorText>
              ) : (
                <progress
                  className="block w-full"
                  max={1}
                  value={p.progress}
                  aria-label={`Uploading ${p.name}`}
                />
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
