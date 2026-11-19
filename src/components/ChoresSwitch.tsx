import { useEffect, useState } from "react";
import { api } from "../client/api.ts";
import { goWithToast } from "../client/toast.ts";
import { ErrorText, useAction } from "./ui.tsx";

/** Turn the Chores tab on or off for the whole group; reloads so the tab shows or hides. */
export default function ChoresSwitch(props: { groupId: number; on: boolean }) {
  const [on, setOn] = useState(props.on);
  const [ready, setReady] = useState(false);
  const { busy, error, run } = useAction();
  useEffect(() => setReady(true), []);
  return (
    <div className="card p-4">
      <label className="flex min-h-11 cursor-pointer items-center gap-3">
        <span className="flex-1">
          <span className="block font-medium">Chores</span>
          <span className="block text-sm text-muted">
            Take turns on jobs like dishes and trash, with a schedule for
            everyone. Adds a Chores tab for the whole group.
          </span>
        </span>
        <input
          type="checkbox"
          role="switch"
          name="chores"
          className="h-6 w-6 shrink-0 accent-accent"
          checked={on}
          disabled={!ready || busy}
          onChange={(e) => {
            const next = e.target.checked;
            setOn(next);
            void run(async () => {
              try {
                await api("PATCH", `/api/groups/${props.groupId}`, {
                  chores: next,
                });
              } catch (err) {
                setOn(!next);
                throw err;
              }
              goWithToast(
                next
                  ? `/groups/${props.groupId}?tab=chores`
                  : `/groups/${props.groupId}?tab=members`,
                next
                  ? "Chores are on for this group"
                  : "Chores are off for this group",
              );
            });
          }}
        />
      </label>
      <ErrorText>{error}</ErrorText>
    </div>
  );
}
