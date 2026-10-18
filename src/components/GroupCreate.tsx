import { useState } from "react";
import { api } from "../client/api.ts";
import { goWithToast } from "../client/toast.ts";
import { ErrorText, Field, NAME_MAX, useAction } from "./ui.tsx";

/**
 * The Groups list header with a "+ New group" button that opens the create
 * form inline. With no groups yet the form starts open, with a line on what
 * a group is. Opens the new group once created.
 */
export default function GroupCreate({ hasGroups }: { hasGroups: boolean }) {
  const [open, setOpen] = useState(!hasGroups);
  const [name, setName] = useState("");
  const [emoji, setEmoji] = useState("👥");
  const { busy, error, run } = useAction();
  return (
    <div className="mb-3">
      <div className="flex min-h-11 items-center justify-between gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">
          {hasGroups ? "Your groups" : "New group"}
        </h2>
        {!open && (
          <button
            type="button"
            className="btn btn-secondary px-3 text-sm"
            onClick={() => setOpen(true)}
          >
            <span aria-hidden="true">+</span> New group
          </button>
        )}
      </div>
      {open && (
        <form
          className="card mt-2 space-y-3 p-4"
          aria-label="New group"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const g = await api<{ id: number; name: string }>(
                "POST",
                "/api/groups",
                { name, emoji },
              );
              goWithToast(`/groups/${g.id}`, `Created ${g.name}`);
            });
          }}
        >
          {!hasGroups && (
            <p className="text-sm text-muted">
              A group is the people you split bills with, like your household.
              Create one to start.
            </p>
          )}
          <div className="flex gap-2">
            <Field
              label="Emoji"
              className="w-20 shrink-0"
              value={emoji}
              maxLength={16}
              onChange={(e) => setEmoji(e.target.value)}
            />
            <Field
              label="Group name"
              maxLength={NAME_MAX}
              className="flex-1"
              value={name}
              placeholder="e.g. Apartment 4B"
              required
              autoFocus={hasGroups}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="flex gap-2">
            {hasGroups && (
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => setOpen(false)}
              >
                Cancel
              </button>
            )}
            <button className="btn btn-primary flex-1" disabled={busy}>
              {busy ? "Creating…" : "Create group"}
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
        </form>
      )}
    </div>
  );
}
