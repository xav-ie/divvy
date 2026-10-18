import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { errorMessage, SESSION_EXPIRED } from "../client/api.ts";
import { isLeaving, leave } from "../client/leave.ts";
import { NAME_MAX } from "../domain/limits.ts";

export { NAME_MAX };

/** Run an async action, tracking busy state and the error message to show inline. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function run(fn: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      // Stay busy while a save navigates away, so a second tap can't resubmit.
      if (!isLeaving()) setBusy(false);
    }
  }
  return { busy, error, setError, run };
}

/** An error from the server or validation, announced to screen readers. */
export function ErrorText({ children }: { children: ReactNode }) {
  if (!children) return null;
  if (children === SESSION_EXPIRED)
    return (
      <div role="alert" className="mt-2 flex flex-wrap items-center gap-2">
        <p className="error flex-1">{children}</p>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => location.reload()}
        >
          Reload
        </button>
      </div>
    );
  return (
    <p role="alert" className="error mt-2">
      {children}
    </p>
  );
}

/** Labelled text input with an inline error. */
export function Field({
  label,
  error,
  className,
  ...input
}: {
  label: string;
  error?: string;
} & React.InputHTMLAttributes<HTMLInputElement>) {
  const id = useId();
  // Count characters once a short limit (names) is close.
  const length = String(input.value ?? "").length;
  const near =
    input.maxLength !== undefined &&
    input.maxLength <= 100 &&
    length >= input.maxLength - 10;
  return (
    <div className={className}>
      <label htmlFor={id} className="label" title={label}>
        {label}
      </label>
      <input
        id={id}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-err` : undefined}
        {...input}
      />
      {error && (
        <p id={`${id}-err`} className="error mt-1">
          {error}
        </p>
      )}
      {near && (
        <p className="mt-1 text-right text-sm text-muted" aria-live="polite">
          {length}/{input.maxLength} characters
        </p>
      )}
    </div>
  );
}

/**
 * A ref that scrolls its element fully into view when `open` turns true;
 * html's scroll-padding keeps it clear of the sticky header and bottom bars.
 */
export function useReveal<T extends HTMLElement>(open: boolean) {
  const ref = useRef<T>(null);
  useEffect(() => {
    if (open)
      ref.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [open]);
  return ref;
}

/**
 * A destructive button that asks inline before acting (never a native confirm).
 * `onConfirm` errors show under the buttons.
 */
export function ConfirmButton({
  label,
  question,
  confirmLabel = label,
  onConfirm,
  className = "",
  compact = false,
  name,
}: {
  label: string;
  question: string;
  confirmLabel?: string;
  onConfirm: () => Promise<void>;
  className?: string;
  /** A small button for rows; the question still opens full width. */
  compact?: boolean;
  /** Accessible name when the visible label is shorter (e.g. "Remove" for "Remove ana@x.com"). */
  name?: string;
}) {
  const [asking, setAsking] = useState(false);
  const { busy, error, run } = useAction();
  const reveal = useReveal<HTMLDivElement>(asking);
  if (!asking)
    return (
      <div className={className}>
        <button
          type="button"
          className={`btn btn-danger ${compact ? "px-3 text-sm" : "w-full"}`}
          aria-label={name}
          onClick={() => setAsking(true)}
        >
          {label}
        </button>
        <ErrorText>{error}</ErrorText>
      </div>
    );
  return (
    <div
      ref={reveal}
      className={`card p-4 ${compact ? "w-full basis-full" : ""} ${className}`}
      role="group"
      aria-label={question}
    >
      <p className="mb-3">{question}</p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-secondary flex-1"
          onClick={() => setAsking(false)}
          disabled={busy}
        >
          Cancel
        </button>
        <button
          type="button"
          className="btn btn-danger flex-1"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await onConfirm();
              setAsking(false);
            })
          }
        >
          {busy ? "Working…" : confirmLabel}
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}

/** Grey placeholder blocks shown while something loads. */
export function Skeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" className="space-y-3">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-14" />
      ))}
    </div>
  );
}

/**
 * Guard a form with unsaved changes: in-app links ask inline (Keep editing /
 * Discard), and reloads, closes and browser back get the browser's own
 * beforeunload prompt. Render the returned element.
 */
export function useLeaveGuard(dirty: boolean): ReactNode {
  const [pending, setPending] = useState<string | null>(null);
  const keep = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (!isLeaving()) e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      if (isLeaving() || e.defaultPrevented || e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!a || a.target === "_blank" || a.origin !== location.origin) return;
      e.preventDefault();
      setPending(a.href);
    };
    // Back/forward would swap pages client-side without asking; cancelling
    // the swap hands it to the browser, whose beforeunload prompt then asks.
    const onSwap = (e: Event) => {
      if (!isLeaving()) e.preventDefault();
    };
    addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    document.addEventListener("astro:before-preparation", onSwap);
    return () => {
      removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("astro:before-preparation", onSwap);
    };
  }, [dirty]);
  useEffect(() => keep.current?.focus(), [pending]);
  if (!pending) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 md:items-center"
      onKeyDown={(e) => e.key === "Escape" && setPending(null)}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="leave-title"
        aria-describedby="leave-desc"
        className="card w-full max-w-sm p-4"
      >
        <h2 id="leave-title" className="text-lg font-semibold">
          Leave without saving?
        </h2>
        <p id="leave-desc" className="mt-1 text-muted">
          What you entered on this page will be lost.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            ref={keep}
            type="button"
            className="btn btn-primary flex-1"
            onClick={() => setPending(null)}
          >
            Keep editing
          </button>
          <button
            type="button"
            className="btn btn-danger flex-1"
            onClick={() => leave(pending)}
          >
            Discard
          </button>
        </div>
      </div>
    </div>
  );
}
