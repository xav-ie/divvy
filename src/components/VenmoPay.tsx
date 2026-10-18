import { useState } from "react";
import { api } from "../client/api.ts";
import { todayLocal } from "../client/format.ts";
import { goWithToast } from "../client/toast.ts";
import { formatCents } from "../domain/money.ts";
import type { PlannedPayment } from "../services/venmo.ts";
import { PersonSpan } from "./RichText.tsx";
import { ErrorText, useAction } from "./ui.tsx";

interface Props {
  /** Who gets paid. */
  name: string;
  cents: number;
  url: string;
  /** divvy's copy of the payee's Venmo photo, to confirm who you're paying. */
  photo?: string | null;
  /** Recorded on "Yes, record it" (from the server's plan)... */
  payment?: PlannedPayment;
  /** ...or recorded by the caller (the settle form). */
  onRecord?: () => Promise<void>;
}

/**
 * "Pay $X on Venmo" (opens the Venmo app on phones), then asks whether the
 * payment went through so it can be recorded. Only ever for paying, never a
 * charge request.
 */
export default function VenmoPay({
  name,
  cents,
  url,
  photo,
  payment,
  onRecord,
}: Props) {
  const [asked, setAsked] = useState(false);
  const { busy, error, run } = useAction();
  const amount = formatCents(cents);
  return (
    <div className="space-y-2" data-testid="venmo-pay">
      <div className="flex items-center gap-2">
        {photo && (
          <img
            src={photo}
            alt={`${name} on Venmo`}
            className="h-8 w-8 shrink-0 rounded-full object-cover"
          />
        )}
        <a
          className="btn btn-primary min-w-0 flex-1"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => setAsked(true)}
        >
          Pay {amount} on Venmo
        </a>
      </div>
      {asked && (
        <div
          className="card space-y-3 p-4"
          role="group"
          aria-label="Record the Venmo payment"
        >
          <p>
            Did you pay <PersonSpan name={name} /> {amount}?
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary flex-1"
              disabled={busy}
              onClick={() => setAsked(false)}
            >
              Not yet
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  if (onRecord) return onRecord();
                  if (payment)
                    await api(
                      "POST",
                      `/api/groups/${payment.groupId}/payments`,
                      {
                        fromMember: payment.fromMember,
                        toMember: payment.toMember,
                        cents: payment.cents,
                        date: todayLocal(),
                        note: "Venmo",
                      },
                    );
                  goWithToast(
                    location.pathname + location.search,
                    `Recorded: you paid ${name} ${amount}`,
                  );
                })
              }
            >
              {busy ? "Saving…" : "Yes, record it"}
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </div>
  );
}
