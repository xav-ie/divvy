import { useEffect, useState } from "react";
import { api, errorMessage } from "../client/api.ts";
import { centsInput } from "../client/format.ts";
import { goWithToast } from "../client/toast.ts";
import { parseCents } from "../domain/money.ts";
import { ordinal, type RecurringView } from "./RecurringTab.tsx";
import Avatar from "./Avatar.tsx";
import { PersonSpan } from "./RichText.tsx";
import { ErrorText, Field, Skeleton, useAction, useLeaveGuard } from "./ui.tsx";

interface Member {
  id: number;
  name: string;
  isYou: boolean;
  placeholder?: boolean;
}

interface Props {
  groupId: number;
  members: Member[];
  me: number;
  /** Present when editing; the template is loaded from the group's list. */
  recurringId?: number;
}

interface FormState {
  title: string;
  day: number;
  amount: string;
  payer: number;
  split: Record<number, number>;
  /** New fixed bills whose day already passed: also add this month's now. */
  billThisMonth: boolean;
}

const label = (m: Member) => (m.isYou ? "You" : m.name);

/** Create or edit a monthly bill: fixed (billed on its day) or varying (billed when you enter the amount). */
export default function RecurringForm({
  groupId,
  members,
  me,
  recurringId,
}: Props) {
  const [f, setF] = useState<FormState | null>(
    recurringId
      ? null
      : {
          title: "",
          day: 1,
          amount: "",
          payer: me,
          split: Object.fromEntries(members.map((m) => [m.id, 1])),
          billThisMonth: false,
        },
  );
  const [loadError, setLoadError] = useState("");
  const [initial, setInitial] = useState(() => JSON.stringify(f));
  const guard = useLeaveGuard(JSON.stringify(f) !== initial);
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!recurringId) return;
    api<RecurringView[]>("GET", `/api/groups/${groupId}/recurring`)
      .then((list) => {
        const r = list.find((x) => x.id === recurringId);
        if (!r)
          return setLoadError("That recurring bill doesn't exist anymore");
        const loaded = {
          title: r.title,
          day: r.dayOfMonth,
          amount: centsInput(r.amountCents),
          payer: r.payerMemberId,
          split: r.split,
          billThisMonth: false,
        };
        setF(loaded);
        setInitial(JSON.stringify(loaded));
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, [groupId, recurringId]);

  if (loadError) return <ErrorText>{loadError}</ErrorText>;
  if (!f) return <Skeleton rows={4} />;
  const set = (p: Partial<FormState>) => setF({ ...f, ...p });
  const now = new Date();
  const month = now.toLocaleString("en-US", { month: "long" });
  const next = new Date(
    now.getFullYear(),
    now.getMonth() + 1,
    1,
  ).toLocaleString("en-US", { month: "long" });
  // A new bill whose day already passed starts next month unless asked.
  const askThisMonth = !recurringId && now.getDate() > f.day;
  const cents = parseCents(f.amount);
  const titleError = tried && !f.title.trim() ? "Give the bill a title" : "";
  const amountError =
    tried && !(cents && cents > 0) ? "Enter an amount above $0.00" : "";
  const splitError =
    tried && !Object.values(f.split).some((w) => w > 0)
      ? "Pick at least one person"
      : "";

  return (
    <form
      noValidate
      aria-label={recurringId ? "Edit recurring bill" : "New recurring bill"}
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (
          !f.title.trim() ||
          !(cents && cents > 0) ||
          !Object.values(f.split).some((w) => w > 0)
        )
          return;
        run(async () => {
          const body = {
            title: f.title,
            dayOfMonth: f.day,
            amountCents: cents,
            split: Object.fromEntries(
              Object.entries(f.split).filter(([, w]) => w > 0),
            ),
            payerMemberId: f.payer,
            ...(askThisMonth ? { billThisMonth: f.billThisMonth } : {}),
          };
          const back = `/groups/${groupId}?recurring=1#recurring`;
          if (recurringId) {
            await api("PATCH", `/api/recurring/${recurringId}`, body);
            return goWithToast(back, `Saved ${f.title.trim()}`);
          }
          const r = await api<{ expenseId?: number }>(
            "POST",
            `/api/groups/${groupId}/recurring`,
            body,
          );
          // "Include this month" on a fixed bill adds it right away.
          if (r.expenseId)
            goWithToast(
              back,
              `Added ${month}'s ${f.title.trim()}`,
              undefined,
              `/expenses/${r.expenseId}`,
            );
          else goWithToast(back, `Saved ${f.title.trim()}`);
        });
      }}
    >
      <div className="space-y-5">
        <Field
          label="Title"
          value={f.title}
          placeholder="e.g. Rent"
          error={titleError}
          onChange={(e) => set({ title: e.target.value })}
        />
        <div>
          <label htmlFor="rec-day" className="label">
            Day of the month
          </label>
          <select
            id="rec-day"
            className="input"
            value={f.day}
            onChange={(e) => set({ day: Number(e.target.value) })}
          >
            {Array.from({ length: 28 }, (_, i) => (
              <option key={i + 1} value={i + 1}>
                {i + 1}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Field
            label="Amount"
            inputMode="decimal"
            placeholder="0.00"
            value={f.amount}
            error={amountError}
            onChange={(e) => set({ amount: e.target.value })}
          />
          <p className="mt-1 text-sm text-muted">
            The same every month; divvy adds it on its day. Bills that change
            every month (electric, gas) are just regular expenses.
          </p>
        </div>
        {askThisMonth && (
          <div>
            <p className="label">
              The {ordinal(f.day)} already passed this month. Include {month}'s
              bill?
            </p>
            <div
              className="flex flex-wrap gap-2"
              role="radiogroup"
              aria-label={`Include ${month}'s bill?`}
            >
              <button
                type="button"
                role="radio"
                aria-checked={f.billThisMonth}
                className="chip"
                onClick={() => set({ billThisMonth: true })}
              >
                Yes, include {month}
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={!f.billThisMonth}
                className="chip"
                onClick={() => set({ billThisMonth: false })}
              >
                No, start in {next}
              </button>
            </div>
          </div>
        )}
        <div>
          <p className="label">Who pays it</p>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Who pays it"
          >
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={f.payer === m.id}
                className="chip"
                title={label(m)}
                onClick={() => set({ payer: m.id })}
              >
                <Avatar
                  name={m.name}
                  id={m.id}
                  placeholder={m.placeholder}
                  size="sm"
                />
                <PersonSpan name={label(m)} id={m.id} className="truncate" />
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="label">Split equally among</p>
          <div className="flex flex-wrap gap-2">
            {members.map((m) => {
              const on = (f.split[m.id] ?? 0) > 0;
              return (
                <button
                  key={m.id}
                  type="button"
                  className="chip"
                  title={label(m)}
                  aria-pressed={on}
                  onClick={() =>
                    set({ split: { ...f.split, [m.id]: on ? 0 : 1 } })
                  }
                >
                  <Avatar
                    name={m.name}
                    id={m.id}
                    placeholder={m.placeholder}
                    size="sm"
                  />
                  <PersonSpan name={label(m)} id={m.id} className="truncate" />
                </button>
              );
            })}
          </div>
          {splitError && <p className="error mt-1">{splitError}</p>}
        </div>
      </div>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
      {guard}
    </form>
  );
}
