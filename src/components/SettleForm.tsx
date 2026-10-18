import { useState } from "react";
import { api } from "../client/api.ts";
import { centsInput, todayLocal } from "../client/format.ts";
import { goWithToast } from "../client/toast.ts";
import { formatCents, parseCents } from "../domain/money.ts";
import { venmoPayUrl } from "../domain/venmo.ts";
import RichText from "./RichText.tsx";
import VenmoPay from "./VenmoPay.tsx";
import { ErrorText, Field, useAction, useLeaveGuard } from "./ui.tsx";

interface Group {
  id: number;
  name: string;
  members: Array<{
    id: number;
    name: string;
    isYou: boolean;
    /** Venmo username, if they gave one. */
    venmo: string | null;
    /** divvy's copy of their Venmo photo, if any. */
    venmoPhoto?: string | null;
  }>;
  /** The biggest amount you owe one person in this group, if any. */
  owe: { to: number; cents: number } | null;
}

interface Props {
  groups: Group[];
  groupId?: number;
  from?: number;
  to?: number;
  cents?: number;
}

const label = (m: Group["members"][number]) => (m.isYou ? "You" : m.name);

/** Record a payment between two members of a group, prefilled from a balance. */
export default function SettleForm(props: Props) {
  const first =
    props.groups.find((g) => g.id === props.groupId) ??
    props.groups.find((g) =>
      [props.from, props.to].every((id) => g.members.some((m) => m.id === id)),
    ) ??
    props.groups[0];
  /** You paying whoever you owe most in `g`, else you paying the first other person. */
  const prefill = (g: Group | undefined) => {
    const you = g?.members.find((m) => m.isYou)?.id;
    return {
      from: you,
      to: g?.owe?.to ?? g?.members.find((m) => m.id !== you)?.id,
      amount: g?.owe ? centsInput(g.owe.cents) : "",
    };
  };
  const given = props.from !== undefined || props.to !== undefined;
  const start = prefill(first);
  const [groupId, setGroupId] = useState(first?.id);
  const [from, setFrom] = useState(
    given ? (props.from ?? start.from) : start.from,
  );
  const [to, setTo] = useState(
    given
      ? (props.to ??
          first?.members.find((m) => m.id !== (props.from ?? start.from))?.id)
      : start.to,
  );
  const [amount, setAmount] = useState(
    props.cents ? centsInput(props.cents) : given ? "" : start.amount,
  );
  const [date, setDate] = useState(todayLocal());
  const [note, setNote] = useState("");
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useAction();
  const snapshot = JSON.stringify({ groupId, from, to, amount, date, note });
  const [initial] = useState(snapshot);
  const guard = useLeaveGuard(snapshot !== initial);

  const group = props.groups.find((g) => g.id === groupId);
  if (!group)
    return (
      <p className="card p-4">
        Create a group first, then you can record payments in it.
      </p>
    );
  const cents = parseCents(amount);
  const amountError =
    cents === null || cents <= 0 ? "Enter an amount above $0.00" : "";
  const sameError = from === to ? "Pick two different people" : "";
  const fromM = group.members.find((m) => m.id === from);
  const toM = group.members.find((m) => m.id === to);
  const sentence =
    fromM && toM && cents && !sameError
      ? `${label(fromM)} paid ${toM.isYou ? "you" : toM.name} ${formatCents(cents)}`
      : "";

  const record = async (withNote: string) => {
    await api("POST", `/api/groups/${group.id}/payments`, {
      fromMember: from,
      toMember: to,
      cents,
      date,
      note: withNote,
    });
    goWithToast(`/groups/${group.id}?tab=balances`, `Recorded: ${sentence}`);
  };
  // You paying someone with a Venmo username: offer the pay link (never a request).
  const venmo =
    fromM?.isYou && toM?.venmo && cents && !amountError && !sameError
      ? { name: toM.name, username: toM.venmo, photo: toM.venmoPhoto, cents }
      : null;

  const select = (
    labelText: string,
    value: number | undefined,
    set: (v: number) => void,
  ) => (
    <div>
      <label className="label" htmlFor={`settle-${labelText}`}>
        {labelText}
      </label>
      <select
        id={`settle-${labelText}`}
        className="input"
        value={value ?? ""}
        onChange={(e) => set(Number(e.target.value))}
      >
        {group.members.map((m) => (
          <option key={m.id} value={m.id}>
            {label(m)}
          </option>
        ))}
      </select>
    </div>
  );

  return (
    <form
      noValidate
      aria-label="Record a payment"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (amountError || sameError) return;
        run(() => record(note));
      }}
    >
      <div className="space-y-4">
        {props.groups.length > 1 && (
          <div>
            <label className="label" htmlFor="settle-group">
              Group
            </label>
            <select
              id="settle-group"
              className="input"
              value={groupId}
              onChange={(e) => {
                // People differ per group: start again from what you owe there.
                const g = props.groups.find(
                  (x) => x.id === Number(e.target.value),
                );
                const p = prefill(g);
                setGroupId(g?.id);
                setFrom(p.from);
                setTo(p.to);
                setAmount(p.amount);
              }}
            >
              {props.groups.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="grid grid-cols-2 gap-3">
          {select("From", from, setFrom)}
          {select("To", to, setTo)}
        </div>
        {tried && sameError && <p className="error">{sameError}</p>}
        <Field
          label="Amount"
          inputMode="decimal"
          value={amount}
          placeholder="0.00"
          error={tried ? amountError : ""}
          onChange={(e) => setAmount(e.target.value)}
        />
        <Field
          label="Date"
          type="date"
          value={date}
          required
          onChange={(e) => setDate(e.target.value)}
        />
        <Field
          label="Note (optional)"
          value={note}
          placeholder="e.g. Venmo"
          maxLength={500}
          onChange={(e) => setNote(e.target.value)}
        />
        {venmo && (
          <VenmoPay
            name={venmo.name}
            photo={venmo.photo}
            cents={venmo.cents}
            url={venmoPayUrl(
              venmo.username,
              venmo.cents,
              `divvy: ${group.name}`,
            )}
            onRecord={() => record(note || "Venmo")}
          />
        )}
      </div>
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-3xl">
          <p className="mb-2 min-h-6 text-center" aria-live="polite">
            {sentence && (
              <RichText
                text={sentence}
                people={group.members.map((m) => ({ id: m.id, name: m.name }))}
                viewer={{ id: group.members.find((m) => m.isYou)?.id }}
              />
            )}
          </p>
          <button className="btn btn-primary w-full" disabled={busy}>
            {busy ? "Saving…" : "Record payment"}
          </button>
          <ErrorText>{error}</ErrorText>
        </div>
      </div>
      {guard}
    </form>
  );
}
