import { useEffect, useRef, useState } from "react";
import { api, ApiError } from "../client/api.ts";
import { formatDate, todayLocal } from "../client/format.ts";
import { goWithToast } from "../client/toast.ts";
import { formatCents } from "../domain/money.ts";
import { ConfirmButton, ErrorText, useAction, useReveal } from "./ui.tsx";

export interface RecurringView {
  id: number;
  title: string;
  dayOfMonth: number;
  amountCents: number;
  split: Record<number, number>;
  payerMemberId: number;
  lastMonth: string | null;
  status: "billed" | "due" | "upcoming";
  /** This month isn't billed yet, so it can be added now (varying bills can come early). */
  canBillNow: boolean;
  /** `YYYY-MM` of the first month it bills, when that's later than its creation. */
  startsMonth: string | null;
  /** `YYYY-MM` whose bill was deleted: offered for adding by hand, never re-added automatically. */
  manualMonth: string | null;
  paused: boolean;
  canEdit: boolean;
}

interface Member {
  id: number;
  name: string;
}

export const ordinal = (n: number) =>
  `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

const OPEN_KEY = "divvy-recurring-open";

/**
 * A group's recurring bills (fixed amounts that add themselves on their day),
 * as a collapsible list at the bottom of the Expenses tab: open state
 * remembered per device, forced open by `?recurring=1`. Changes reload the
 * page so the expense list stays in step.
 */
export default function RecurringBills({
  groupId,
  members,
  initial,
}: {
  groupId: number;
  members: Member[];
  /** Rendered by the server, so the list shows at once. */
  initial: RecurringView[];
}) {
  const nameOf = (id: number) =>
    members.find((m) => m.id === id)?.name ?? "A former member";
  const [open, setOpen] = useState(() => {
    if (new URLSearchParams(location.search).has("recurring")) return true;
    return localStorage.getItem(OPEN_KEY) === "1";
  });
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (new URLSearchParams(location.search).has("recurring"))
      ref.current?.scrollIntoView({ block: "start" });
  }, []);
  const changed = (msg: string) =>
    goWithToast(location.pathname + location.search, msg);

  return (
    <details
      ref={ref}
      id="recurring"
      className="card mt-6 scroll-mt-20"
      open={open}
      onToggle={(e) => {
        const now = (e.target as HTMLDetailsElement).open;
        setOpen(now);
        localStorage.setItem(OPEN_KEY, now ? "1" : "0");
      }}
    >
      <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 font-medium">
        <span className="flex-1">Recurring bills ({initial.length})</span>
        <svg
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform ${open ? "rotate-90" : ""}`}
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </summary>
      <div className="space-y-4 px-4 pb-4">
        <a
          href={`/groups/${groupId}/recurring/new`}
          className="btn btn-primary w-full"
        >
          Add recurring bill
        </a>
        {initial.length === 0 ? (
          <p className="text-muted">
            For fixed amounts like rent or subscriptions. Bills that change
            every month (electric, gas) are just regular expenses.
          </p>
        ) : (
          <ul className="space-y-3" aria-label="Recurring bills">
            {initial.map((r) => (
              <Row
                key={r.id}
                groupId={groupId}
                r={r}
                nameOf={nameOf}
                onChanged={changed}
              />
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}

function Row({
  groupId,
  r,
  nameOf,
  onChanged,
}: {
  groupId: number;
  r: RecurringView;
  nameOf: (id: number) => string;
  onChanged: (message: string) => void;
}) {
  /** The bill waiting for "Add bill" in the inline confirmation. */
  const [confirm, setConfirm] = useState<{
    cents: number;
    duplicate?: number;
  } | null>(null);
  const bill = useAction();
  const pause = useAction();
  const reveal = useReveal<HTMLDivElement>(!!confirm);
  const now = new Date();
  const today = todayLocal(now);
  const month = now.toLocaleString("en-US", { month: "long" });
  const day = Number(today.slice(8, 10));
  // Billing before the template's day dates it today; otherwise on its day.
  const dueOn = `${today.slice(0, 8)}${String(r.dayOfMonth).padStart(2, "0")}`;
  const billOn = day < r.dayOfMonth ? today : dueOn;
  const nextOn = todayLocal(
    new Date(now.getFullYear(), now.getMonth() + 1, r.dayOfMonth),
  );

  const who = Object.entries(r.split)
    .filter(([, w]) => w > 0)
    .map(([id]) => nameOf(Number(id)));
  const thisMonth = today.slice(0, 7);
  const startsOn =
    r.startsMonth && r.startsMonth > thisMonth
      ? `${r.startsMonth}-${String(r.dayOfMonth).padStart(2, "0")}`
      : null;
  // Bills add themselves; only a month whose bill was deleted is added by hand.
  const canReadd = r.manualMonth === thisMonth && r.canBillNow && !r.paused;
  const status = r.paused
    ? "Paused: nothing is added until you resume it"
    : startsOn
      ? `Starts ${formatDate(startsOn)}`
      : !r.canBillNow
        ? `Added for ${month}; next on ${formatDate(nextOn)}`
        : r.manualMonth === thisMonth
          ? `${month}'s bill was deleted; divvy won't add it again, add it yourself if needed`
          : r.status === "due"
            ? `Not added for ${month} yet; divvy adds it automatically within a day`
            : `divvy adds it automatically on ${formatDate(dueOn)}`;

  const doBill = (cents: number, confirmDuplicate = false) =>
    bill.run(async () => {
      try {
        await api("POST", `/api/recurring/${r.id}/bill`, {
          ...(confirmDuplicate ? { confirmDuplicate } : {}),
        });
      } catch (err) {
        const id =
          err instanceof ApiError ? err.data.existingExpenseId : undefined;
        if (typeof id !== "number") throw err;
        setConfirm({ cents, duplicate: id });
        return;
      }
      setConfirm(null);
      onChanged(`Added ${r.title} for ${month}`);
    });

  return (
    <li
      className="space-y-3 rounded-xl border border-line p-3"
      aria-label={r.title}
    >
      <div>
        <p className="flex justify-between gap-2 font-medium">
          <span className="min-w-0 break-words">{r.title}</span>
          <span className="shrink-0">{formatCents(r.amountCents)}</span>
        </p>
        <p className="text-sm text-muted">
          Monthly on the {ordinal(r.dayOfMonth)} · {nameOf(r.payerMemberId)}{" "}
          {nameOf(r.payerMemberId) === "You" ? "pay" : "pays"} · split with{" "}
          {who.map((n) => (n === "You" ? "you" : n)).join(", ")}
        </p>
        <p
          className={`mt-1 text-sm font-medium ${r.status === "due" && !r.paused ? "text-accent" : ""}`}
        >
          {status}
        </p>
      </div>

      {canReadd && !confirm && (
        <button
          type="button"
          className="btn btn-secondary w-full"
          onClick={() => setConfirm({ cents: r.amountCents })}
        >
          Add {month}'s bill again
        </button>
      )}
      {confirm && (
        <div
          ref={reveal}
          className="rounded-xl border border-accent bg-accent-soft p-3"
          role="group"
          aria-label={`Add ${r.title}`}
        >
          {confirm.duplicate ? (
            <p>
              {r.title} for {month} already looks entered:{" "}
              <a
                className="font-medium text-accent underline"
                href={`/expenses/${confirm.duplicate}`}
              >
                see that expense
              </a>
              . Add anyway?
            </p>
          ) : (
            <p>
              Add {r.title} for {month}: {formatCents(confirm.cents)}, dated{" "}
              {formatDate(billOn)}, paid by{" "}
              {nameOf(r.payerMemberId) === "You"
                ? "you"
                : nameOf(r.payerMemberId)}
              ?
            </p>
          )}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="btn btn-secondary flex-1"
              onClick={() => setConfirm(null)}
              disabled={bill.busy}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={bill.busy}
              onClick={() => doBill(confirm.cents, !!confirm.duplicate)}
            >
              {bill.busy
                ? "Adding…"
                : confirm.duplicate
                  ? "Add anyway"
                  : "Add bill"}
            </button>
          </div>
        </div>
      )}
      <ErrorText>{bill.error}</ErrorText>

      {r.canEdit && (
        <div className="flex flex-wrap gap-2">
          <a
            href={`/groups/${groupId}/recurring/${r.id}`}
            className="btn btn-secondary px-3 text-sm"
          >
            Edit
          </a>
          <button
            type="button"
            className="btn btn-secondary px-3 text-sm"
            disabled={pause.busy}
            onClick={() =>
              pause.run(async () => {
                await api("PATCH", `/api/recurring/${r.id}`, {
                  paused: !r.paused,
                });
                onChanged(
                  r.paused ? `Resumed ${r.title}` : `Paused ${r.title}`,
                );
              })
            }
          >
            {r.paused ? "Resume" : "Pause"}
          </button>
          <ConfirmButton
            compact
            className="ml-auto"
            label="Delete"
            question={`Delete the recurring bill "${r.title}"? Bills already added stay.`}
            onConfirm={async () => {
              await api("DELETE", `/api/recurring/${r.id}`);
              onChanged(`Deleted ${r.title}`);
            }}
          />
        </div>
      )}
      <ErrorText>{pause.error}</ErrorText>
    </li>
  );
}
