import { useEffect, useRef, useState } from "react";
import { api } from "../client/api.ts";
import { centsInput, todayLocal } from "../client/format.ts";
import { goWithToast } from "../client/toast.ts";
import { formatCents } from "../domain/money.ts";
import { SPLIT_TYPES, type MemberId, type SplitType } from "../domain/types.ts";
import {
  compute,
  emptyState,
  fromExpense,
  itemLine,
  itemShares,
  newItem,
  resplit,
  setItemize,
  splitGap,
  toInput,
  type EditorState,
  type Extra,
  type ItemState,
  type SavedExpense,
} from "./editor/model.ts";
import AttachmentUploader, {
  formatSize,
  type UploadedAttachment,
} from "./AttachmentUploader.tsx";
import Avatar from "./Avatar.tsx";
import RichText, { PersonSpan } from "./RichText.tsx";
import { ErrorText, Field, useAction, useLeaveGuard } from "./ui.tsx";

interface Member {
  id: MemberId;
  name: string;
  isYou: boolean;
  placeholder?: boolean;
}

interface Props {
  groupId: number;
  members: Member[];
  me: MemberId;
  /** Present when editing. */
  expense?: SavedExpense & { id: number };
  /** A photo shared to divvy: attached, and read when scanning is on. */
  sharedReceiptId?: number;
}

interface ScanResult {
  receiptId: number;
  merchant: string;
  date: string | null;
  items: Array<{ name: string; quantity: number; unitCents: number }>;
  taxCents: number;
  tipCents: number;
  discountCents: number;
  totalCents: number;
}

const SPLIT_LABELS: Record<SplitType, string> = {
  equal: "Equally",
  percent: "By %",
  exact: "By amount",
  shares: "By shares",
};

const label = (m: Member) => (m.isYou ? "You" : m.name);

/** One full-screen form for adding or editing an expense, with a live per-person summary. */
export default function ExpenseEditor({
  groupId,
  members,
  me,
  expense,
  sharedReceiptId,
}: Props) {
  const everyone = members.map((m) => m.id);
  const [s, setS] = useState<EditorState>(() =>
    expense
      ? fromExpense(expense, me)
      : {
          ...emptyState(everyone, me, todayLocal()),
          receiptId: sharedReceiptId ?? null,
        },
  );
  const [initial] = useState(() => JSON.stringify(s));
  const guard = useLeaveGuard(JSON.stringify(s) !== initial);
  const [tried, setTried] = useState(false);
  const [scanOn, setScanOn] = useState(false);
  /** Files uploaded in this form, linked to the expense when it's saved. */
  const [attached, setAttached] = useState<UploadedAttachment[]>([]);
  const [scanNote, setScanNote] = useState("");
  const save = useAction();
  const scan = useAction();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    api<{ scan: boolean }>("GET", "/api/config")
      .then((c) => {
        setScanOn(c.scan);
        if (!sharedReceiptId) return;
        if (!c.scan)
          return setScanNote(
            "The shared photo is attached as the receipt. Enter the amount by hand.",
          );
        void scan.run(async () =>
          applyScan(
            await api<ScanResult>(
              "POST",
              `/api/receipts/${sharedReceiptId}/scan`,
            ),
          ),
        );
      })
      .catch(() => setScanOn(false));
  }, []);

  const c = compute(s);
  const set = (patch: Partial<EditorState>) =>
    setS((p) => ({ ...p, ...patch }));
  const setItem = (key: number, f: (it: ItemState) => ItemState) =>
    setS((p) => ({
      ...p,
      items: p.items.map((it) => (it.key === key ? f(it) : it)),
    }));

  const titleError = tried && !s.title.trim() ? "Give the expense a title" : "";
  const amountError =
    tried && !s.itemize && !(c.split.subtotalCents > 0)
      ? "Enter an amount above $0.00"
      : "";
  // Empty amounts get one message on their own field, not a second one here.
  const emptyAmounts = s.itemize
    ? s.items.some((it) => !Number.isFinite(itemLine(s, it)))
    : !(c.split.subtotalCents > 0);
  const summaryErrors = emptyAmounts
    ? c.errors.filter(
        (e) =>
          !/needs a (price|quantity)|total must be more|Someone has to have paid/.test(
            e,
          ),
      )
    : c.errors;

  async function onScan(file: File) {
    setScanNote("");
    await scan.run(async () => {
      const form = new FormData();
      form.append("file", file);
      applyScan(await api<ScanResult>("POST", "/api/receipts/scan", form));
    });
  }

  /** Fill the form from a read receipt and link it. */
  function applyScan(r: ScanResult) {
    const dollars = (v: number): Extra => ({
      value: v ? centsInput(v) : "",
      unit: "$",
    });
    setS((p) => {
      const next: EditorState = {
        ...p,
        title: p.title.trim() ? p.title : r.merchant,
        date: r.date || p.date,
        itemize: true,
        items: r.items.map((it) =>
          newItem(everyone, {
            name: it.name,
            qty: String(it.quantity),
            price: centsInput(it.unitCents),
          }),
        ),
        tax: dollars(r.taxCents),
        tip: dollars(r.tipCents),
        discount: dollars(r.discountCents),
        receiptId: r.receiptId,
      };
      const total = compute(next).split.totalCents;
      setScanNote(
        total === r.totalCents
          ? `Filled ${r.items.length} items from the receipt (${formatCents(r.totalCents)}). Check who had what.`
          : `The receipt says ${formatCents(r.totalCents)} but the items add up to ${formatCents(total)}. Check the items.`,
      );
      return next;
    });
  }

  function submit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setTried(true);
    if (!s.title.trim() || c.errors.length) {
      requestAnimationFrame(() =>
        formRef.current
          ?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]')
          ?.scrollIntoView({ block: "center", behavior: "smooth" }),
      );
      return;
    }
    save.run(async () => {
      const body = {
        ...toInput(s, c),
        ...(attached.length
          ? { attachmentIds: attached.map((a) => a.id) }
          : {}),
      };
      if (expense) {
        await api("PUT", `/api/expenses/${expense.id}`, body);
        goWithToast(`/expenses/${expense.id}`, `Saved ${body.title}`);
      } else {
        await api("POST", `/api/groups/${groupId}/expenses`, body);
        goWithToast(`/groups/${groupId}`, `Added ${body.title}`);
      }
    });
  }

  return (
    <form
      ref={formRef}
      noValidate
      onSubmit={submit}
      aria-label={expense ? "Edit expense" : "Add expense"}
    >
      <div className="space-y-5">
        <Field
          label="Title"
          value={s.title}
          placeholder="e.g. Groceries"
          maxLength={200}
          error={titleError}
          onChange={(e) => set({ title: e.target.value })}
        />

        <div className="grid grid-cols-2 gap-3">
          {!s.itemize && (
            <Field
              label="Amount"
              inputMode="decimal"
              placeholder="0.00"
              value={s.amount}
              error={amountError}
              onChange={(e) => set({ amount: e.target.value })}
            />
          )}
          <Field
            label="Date"
            type="date"
            value={s.date}
            className={s.itemize ? "col-span-2" : ""}
            onChange={(e) => set({ date: e.target.value })}
          />
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            role="switch"
            aria-checked={s.itemize}
            className="group inline-flex min-h-11 cursor-pointer items-center gap-3 rounded-xl pr-2 text-base"
            onClick={() => setS((p) => setItemize(p, !p.itemize))}
          >
            <span className="relative h-7 w-12 shrink-0 rounded-full border border-line bg-line transition-colors group-aria-checked:border-accent group-aria-checked:bg-accent">
              <span className="absolute top-0.5 left-0.5 h-5.5 w-5.5 rounded-full bg-surface shadow transition-transform group-aria-checked:translate-x-5" />
            </span>
            Itemize
          </button>
          {scanOn && (
            <label className={`chip ${scan.busy ? "opacity-60" : ""}`}>
              <input
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label="Scan receipt"
                disabled={scan.busy}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = "";
                  if (f) void onScan(f);
                }}
              />
              {scan.busy ? "Reading receipt…" : "Scan receipt"}
            </label>
          )}
        </div>
        {scan.busy && (
          <div
            aria-busy="true"
            aria-label="Reading the receipt"
            className="space-y-2"
          >
            <p className="text-sm text-muted">
              Reading the receipt, this can take up to a minute…
            </p>
            <div className="skeleton h-10" />
            <div className="skeleton h-10" />
          </div>
        )}
        <ErrorText>{scan.error}</ErrorText>
        {scanNote && (
          <p className="card p-3 text-sm" role="status">
            {scanNote}
          </p>
        )}

        {s.itemize ? (
          <section aria-label="Items" className="space-y-3">
            {s.items.map((it, i) => (
              <ItemCard
                key={it.key}
                index={i}
                item={it}
                state={s}
                members={members}
                tried={tried}
                canRemove={s.items.length > 1}
                onChange={(f) => setItem(it.key, f)}
                onRemove={() =>
                  set({ items: s.items.filter((x) => x.key !== it.key) })
                }
              />
            ))}
            <button
              type="button"
              className="btn btn-secondary w-full"
              onClick={() => set({ items: [...s.items, newItem(everyone)] })}
            >
              Add item
            </button>
            <div className="card space-y-3 p-4">
              <p className="flex justify-between">
                <span>Subtotal</span>
                <span>{formatCents(c.split.subtotalCents)}</span>
              </p>
              {(["tax", "tip", "discount"] as const).map((k) => (
                <ExtraField
                  key={k}
                  name={k === "tax" ? "Tax" : k === "tip" ? "Tip" : "Discount"}
                  extra={s[k]}
                  cents={c[`${k}Cents`]}
                  onChange={(v) => set({ [k]: v })}
                />
              ))}
              <p className="text-sm text-muted">
                Tax, tip and discount are shared in proportion to what each
                person's items cost.
              </p>
            </div>
          </section>
        ) : (
          <section aria-label="Split" className="card p-4">
            <SplitEditor
              item={s.single}
              state={s}
              members={members}
              onChange={(f) => setS((p) => ({ ...p, single: f(p.single) }))}
            />
          </section>
        )}

        <Payers
          s={s}
          total={c.split.totalCents}
          remaining={c.remainingCents}
          members={members}
          set={set}
        />

        <div>
          <label htmlFor="expense-notes" className="label">
            Notes (optional)
          </label>
          <textarea
            id="expense-notes"
            className="input min-h-20 py-2"
            value={s.notes}
            maxLength={5000}
            onChange={(e) => set({ notes: e.target.value })}
          />
        </div>

        <section aria-labelledby="editor-attachments" className="space-y-3">
          <h2 id="editor-attachments" className="label">
            Attachments (optional)
          </h2>
          {attached.length > 0 && (
            <ul className="space-y-1 text-sm" aria-label="Attached files">
              {attached.map((a) => (
                <li key={a.id} className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate">
                    {a.label ? `${a.label} (${a.filename})` : a.filename}
                  </span>
                  <span className="text-muted">{formatSize(a.size)}</span>
                </li>
              ))}
            </ul>
          )}
          <AttachmentUploader
            endpoint="/api/attachments"
            onUploaded={(a) => setAttached((xs) => [...xs, a])}
          />
          {attached.length > 0 && (
            <p className="text-sm text-muted">Attached when you save.</p>
          )}
        </section>

        <section aria-label="Summary" className="card p-4" aria-live="polite">
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
            Each person's share
          </h2>
          {/* Best-effort shares would mislead while a split doesn't add up. */}
          <ul className="space-y-1" hidden={c.split.errors.length > 0}>
            {members
              .filter((m) => c.split.shares[m.id])
              .map((m) => (
                <li key={m.id} className="flex justify-between gap-2">
                  <span>
                    {m.isYou ? (
                      <>
                        <PersonSpan name="Your" id={m.id} /> share
                      </>
                    ) : (
                      <>
                        <PersonSpan name={m.name} id={m.id} />
                        's share
                      </>
                    )}
                  </span>
                  <span className="font-medium">
                    {formatCents(c.split.shares[m.id]!)}
                  </span>
                </li>
              ))}
          </ul>
          {c.split.errors.length > 0 && !emptyAmounts && (
            <p className="text-muted">Shares show once every split adds up.</p>
          )}
          {Object.keys(c.split.shares).length === 0 && (
            <p className="text-muted">
              Enter an amount to see everyone's share.
            </p>
          )}
          {tried && summaryErrors.length > 0 && (
            <ul role="alert" className="error mt-3 list-disc space-y-1 pl-5">
              {summaryErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
        </section>
      </div>

      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-surface p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto flex max-w-3xl items-center gap-3">
          <p className="min-w-0 flex-1">
            <span className="block text-sm text-muted">Total</span>
            <span className="block text-lg font-semibold" data-testid="total">
              {formatCents(Math.max(c.split.totalCents, 0))}
            </span>
          </p>
          <button className="btn btn-primary flex-1" disabled={save.busy}>
            {save.busy ? "Saving…" : "Save"}
          </button>
        </div>
        <div className="mx-auto max-w-3xl">
          <ErrorText>{save.error}</ErrorText>
        </div>
      </div>
      {guard}
    </form>
  );
}

function ItemCard(props: {
  index: number;
  item: ItemState;
  state: EditorState;
  members: Member[];
  tried: boolean;
  canRemove: boolean;
  onChange: (f: (it: ItemState) => ItemState) => void;
  onRemove: () => void;
}) {
  const { item, onChange } = props;
  const line = itemLine(props.state, item);
  const priceError =
    props.tried && !Number.isFinite(line) ? "Enter a price and quantity" : "";
  const name = `Item ${props.index + 1}`;
  return (
    <div role="group" aria-label={name} className="card space-y-3 p-4">
      <div className="flex items-end gap-2">
        <Field
          label={name}
          className="min-w-0 flex-1"
          placeholder="e.g. Pizza"
          value={item.name}
          onChange={(e) => onChange((it) => ({ ...it, name: e.target.value }))}
        />
        {props.canRemove && (
          <button
            type="button"
            className="btn btn-ghost px-3"
            aria-label={`Remove ${item.name || name}`}
            onClick={props.onRemove}
          >
            Remove
          </button>
        )}
      </div>
      <div className="grid grid-cols-[5rem_1fr] gap-2">
        <Field
          label="Qty"
          inputMode="decimal"
          value={item.qty}
          onChange={(e) => onChange((it) => ({ ...it, qty: e.target.value }))}
        />
        <Field
          label="Price each"
          inputMode="decimal"
          placeholder="0.00"
          value={item.price}
          error={priceError}
          onChange={(e) => onChange((it) => ({ ...it, price: e.target.value }))}
        />
      </div>
      <SplitEditor
        item={item}
        state={props.state}
        members={props.members}
        onChange={onChange}
      />
    </div>
  );
}

/** Who shares an item (chips) and how (equal, percent, exact, shares). */
function SplitEditor(props: {
  item: ItemState;
  state: EditorState;
  members: Member[];
  onChange: (f: (it: ItemState) => ItemState) => void;
}) {
  const { item, members, onChange } = props;
  const lineTotal = itemLine(props.state, item);
  const gap = splitGap(props.state, item);
  const shares = gap ? null : itemShares(props.state, item);
  const toggle = (id: MemberId) =>
    onChange((it) => {
      const on = it.who.includes(id);
      const who = on
        ? it.who.filter((x) => x !== id)
        : members
            .map((m) => m.id)
            .filter((x) => x === id || it.who.includes(x));
      const values = { ...it.values };
      if (!on && it.splitType === "shares") values[id] = "1";
      return { ...it, who, values };
    });
  const unit = { equal: "", percent: "%", exact: "$", shares: "shares" }[
    item.splitType
  ];
  return (
    <div className="space-y-3">
      <div>
        <p className="label">Split among</p>
        <div className="flex flex-wrap gap-2">
          {members.map((m) => (
            <button
              key={m.id}
              type="button"
              className="chip"
              title={label(m)}
              aria-pressed={item.who.includes(m.id)}
              onClick={() => toggle(m.id)}
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
        <p className="label">How</p>
        <div
          className="flex flex-wrap gap-2"
          role="radiogroup"
          aria-label="Split type"
        >
          {SPLIT_TYPES.map((t) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={item.splitType === t}
              className="chip"
              onClick={() => onChange((it) => resplit(it, t, lineTotal))}
            >
              {SPLIT_LABELS[t]}
            </button>
          ))}
        </div>
      </div>
      {item.splitType !== "equal" && (
        <div className="grid grid-cols-2 gap-2">
          {members
            .filter((m) => item.who.includes(m.id))
            .map((m) => (
              <Field
                key={m.id}
                label={`${label(m)} (${unit})`}
                inputMode="decimal"
                value={item.values[m.id] ?? ""}
                onChange={(e) =>
                  onChange((it) => ({
                    ...it,
                    values: { ...it.values, [m.id]: e.target.value },
                  }))
                }
              />
            ))}
        </div>
      )}
      {item.splitType !== "equal" && (
        <p
          className={`text-sm ${gap ? "font-medium text-danger" : "text-muted"}`}
          aria-live="polite"
          data-testid="split-status"
        >
          {gap ??
            (shares && (
              <RichText
                text={members
                  .filter((m) => shares[m.id])
                  .map((m) => `${label(m)} ${formatCents(shares[m.id]!)}`)
                  .join(" · ")}
                people={members.map((m) => ({ id: m.id, name: m.name }))}
                viewer={{ id: members.find((m) => m.isYou)?.id }}
              />
            ))}
        </p>
      )}
    </div>
  );
}

function ExtraField(props: {
  name: string;
  extra: Extra;
  cents: number;
  onChange: (e: Extra) => void;
}) {
  const { name, extra } = props;
  return (
    <div className="flex items-end gap-2">
      <Field
        label={name}
        className="min-w-0 flex-1"
        inputMode="decimal"
        placeholder={extra.unit === "$" ? "0.00" : "0"}
        value={extra.value}
        onChange={(e) => props.onChange({ ...extra, value: e.target.value })}
      />
      <div
        className="flex shrink-0 gap-1"
        role="radiogroup"
        aria-label={`${name} as`}
      >
        {(["$", "%"] as const).map((u) => (
          <button
            key={u}
            type="button"
            role="radio"
            aria-checked={extra.unit === u}
            aria-label={`${name} in ${u === "$" ? "dollars" : "percent"}`}
            className="chip w-11 justify-center px-0"
            onClick={() => props.onChange({ ...extra, unit: u })}
          >
            {u}
          </button>
        ))}
      </div>
      <span className="w-16 shrink-0 pb-3 text-right text-sm text-muted">
        {extra.unit === "%" && Number.isFinite(props.cents)
          ? formatCents(props.cents)
          : ""}
      </span>
    </div>
  );
}

function Payers(props: {
  s: EditorState;
  total: number;
  remaining: number;
  members: Member[];
  set: (p: Partial<EditorState>) => void;
}) {
  const { s, members, set } = props;
  return (
    <section aria-label="Who paid" className="card space-y-3 p-4">
      <p className="label">Who paid</p>
      {!s.several ? (
        <>
          <div
            className="flex flex-wrap gap-2"
            role="radiogroup"
            aria-label="Paid by"
          >
            {members.map((m) => (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={s.payer === m.id}
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
          <button
            type="button"
            className="btn btn-ghost px-0"
            onClick={() =>
              set({
                several: true,
                paid: {
                  [s.payer]: props.total > 0 ? centsInput(props.total) : "",
                },
              })
            }
          >
            Several people paid
          </button>
        </>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2">
            {members.map((m) => (
              <Field
                key={m.id}
                label={`${label(m)} paid`}
                inputMode="decimal"
                placeholder="0.00"
                value={s.paid[m.id] ?? ""}
                onChange={(e) =>
                  set({ paid: { ...s.paid, [m.id]: e.target.value } })
                }
              />
            ))}
          </div>
          <p className="text-sm" aria-live="polite" data-testid="remaining">
            {props.total <= 0
              ? "Enter the amount first."
              : props.remaining === 0
                ? "Paid amounts match the total."
                : props.remaining > 0
                  ? `${formatCents(props.remaining)} left to assign`
                  : `${formatCents(props.remaining)} too much`}
          </p>
          <button
            type="button"
            className="btn btn-ghost px-0"
            onClick={() => set({ several: false })}
          >
            One person paid
          </button>
        </>
      )}
    </section>
  );
}
