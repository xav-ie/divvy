import { useEffect, useState } from "react";
import { api } from "../client/api.ts";
import { toast } from "../client/toast.ts";
import { ErrorText, useAction } from "./ui.tsx";

/**
 * The group's saved Simplify setting. The checkbox drives which list shows
 * (CSS in global.css); toggling saves it for everyone in the group.
 */
export default function SimplifySwitch(props: {
  groupId: number;
  on: boolean;
  /** Simplifying wouldn't change any payment. */
  noChange: boolean;
}) {
  const [on, setOn] = useState(props.on);
  const [ready, setReady] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => setReady(true), []);
  return (
    <div className="card p-4">
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <span className="flex-1">
          <span className="block font-medium">Simplify</span>
          <span className="block text-sm text-muted">
            {props.noChange
              ? "Already as simple as it gets: no payment would change."
              : "Fewer payments that settle everyone; what each person owes in total stays the same. Saved for the whole group."}
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          name="simplify"
          className="h-6 w-6 shrink-0 accent-accent"
          checked={on}
          disabled={!ready || busy}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            void run(async () => {
              try {
                await api("PATCH", `/api/groups/${props.groupId}`, {
                  simplify: next,
                });
              } catch (err) {
                setOn(!next);
                throw err;
              }
              toast(
                next
                  ? "Simplify is on for this group"
                  : "Simplify is off for this group",
              );
            });
          }}
        />
      </label>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
