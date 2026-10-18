import { useState } from "react";
import { api } from "../client/api.ts";
import Avatar from "./Avatar.tsx";
import RichText from "./RichText.tsx";
import { PersonSpan } from "./RichText.tsx";
import { goWithToast } from "../client/toast.ts";
import { ConfirmButton, ErrorText, Field, NAME_MAX, useAction } from "./ui.tsx";

interface Member {
  id: number;
  name: string;
  inviteEmail: string | null;
  placeholder: boolean;
  isYou: boolean;
  userId: number | null;
}

interface Props {
  groupId: number;
  name: string;
  emoji: string;
  isCreator: boolean;
  createdBy: number;
  members: Member[];
  /** Member id -> their total in the group, as a sentence ("Cy owes $12.00 in total"). */
  balances: Record<number, { cents: number; sentence: string }>;
}

const reload = (message: string) =>
  goWithToast(location.pathname + location.search, message);

/** Invite form for a placeholder, opened from its row. */
function InviteForm({
  groupId,
  m,
  onCancel,
}: {
  groupId: number;
  m: Member;
  onCancel: () => void;
}) {
  const [email, setEmail] = useState(m.inviteEmail ?? "");
  const { busy, error, run } = useAction();
  return (
    <form
      className="mt-3 w-full space-y-2"
      aria-label={`Invite ${m.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          await api("PATCH", `/api/groups/${groupId}/members/${m.id}`, {
            email,
          });
          reload(`Invited ${m.name} as ${email.trim().toLowerCase()}`);
        });
      }}
    >
      <Field
        label={`Email for ${m.name}`}
        type="email"
        inputMode="email"
        autoComplete="off"
        value={email}
        required
        onChange={(e) => setEmail(e.target.value)}
      />
      <p className="text-sm text-muted">
        When they sign in with this email they take over {m.name}'s expenses and
        payments.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-secondary flex-1"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button className="btn btn-primary flex-1" disabled={busy}>
          {busy ? "Saving…" : "Send invite"}
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

/** Rename form for a placeholder, opened from its row. */
function RenameForm({
  groupId,
  m,
  onCancel,
}: {
  groupId: number;
  m: Member;
  onCancel: () => void;
}) {
  const [name, setName] = useState(m.name);
  const { busy, error, run } = useAction();
  return (
    <form
      className="mt-3 w-full space-y-2"
      aria-label={`Rename ${m.name}`}
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const r = await api<{ name: string }>(
            "PATCH",
            `/api/groups/${groupId}/members/${m.id}`,
            { name },
          );
          reload(`Renamed ${m.name} to ${r.name}`);
        });
      }}
    >
      <Field
        label={`New name for ${m.name}`}
        maxLength={NAME_MAX}
        value={name}
        required
        onChange={(e) => setName(e.target.value)}
      />
      <div className="flex gap-2">
        <button
          type="button"
          className="btn btn-secondary flex-1"
          onClick={onCancel}
        >
          Cancel
        </button>
        <button className="btn btn-primary flex-1" disabled={busy}>
          {busy ? "Saving…" : "Save name"}
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

function AddPerson({ groupId }: { groupId: number }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const { busy, error, run } = useAction();
  return (
    <form
      className="card space-y-3 p-4"
      aria-label="Add someone"
      onSubmit={(e) => {
        e.preventDefault();
        run(async () => {
          const m = await api<{ name: string }>(
            "POST",
            `/api/groups/${groupId}/members`,
            {
              ...(name.trim() ? { name } : {}),
              ...(email.trim() ? { email } : {}),
            },
          );
          reload(`Added ${m.name}`);
        });
      }}
    >
      <Field
        label="Name"
        maxLength={NAME_MAX}
        value={name}
        placeholder="e.g. Cy"
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        label="Email (optional)"
        type="email"
        inputMode="email"
        autoComplete="off"
        value={email}
        placeholder="e.g. cy@example.com"
        onChange={(e) => setEmail(e.target.value)}
      />
      <p className="text-sm text-muted">
        Without an email they're added as a placeholder you can split with now
        and invite later.
      </p>
      <button className="btn btn-primary w-full" disabled={busy}>
        {busy ? "Adding…" : "Add to group"}
      </button>
      <ErrorText>{error}</ErrorText>
    </form>
  );
}

function Settings(props: Props) {
  const [name, setName] = useState(props.name);
  const [emoji, setEmoji] = useState(props.emoji);
  const { busy, error, run } = useAction();
  return (
    <div className="space-y-4">
      <form
        className="card space-y-3 p-4"
        aria-label="Group settings"
        onSubmit={(e) => {
          e.preventDefault();
          run(async () => {
            await api("PATCH", `/api/groups/${props.groupId}`, {
              name,
              emoji,
            });
            reload("Group saved");
          });
        }}
      >
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
            required
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <button className="btn btn-primary w-full" disabled={busy}>
          {busy ? "Saving…" : "Save group"}
        </button>
        <ErrorText>{error}</ErrorText>
      </form>
      <ConfirmButton
        label="Delete group"
        question={`Delete ${props.name} with all its expenses and payments? This can't be undone.`}
        confirmLabel="Delete group"
        onConfirm={async () => {
          await api("DELETE", `/api/groups/${props.groupId}`);
          goWithToast("/groups", `Deleted ${props.name}`);
        }}
      />
    </div>
  );
}

/**
 * One member: avatar and text get the full width; actions sit below on narrow
 * cards and to the right on wide ones. Remove is rare and destructive, so it
 * hides behind "More".
 */
function MemberRow({ m, ...props }: Props & { m: Member }) {
  const [panel, setPanel] = useState<"rename" | "invite" | "more" | null>(null);
  const toggle = (p: typeof panel) => setPanel((cur) => (cur === p ? null : p));
  const canRemove = props.isCreator && !m.isYou && m.userId !== props.createdBy;
  // Renaming and inviting placeholders is the creator's: an invite decides
  // who takes over the placeholder's balance. Others see the status only.
  const canChange = m.placeholder && props.isCreator;
  const owes = props.balances[m.id]?.cents ? props.balances[m.id]! : null;
  return (
    <li className="@container px-4 py-3">
      <div
        className={
          canChange
            ? "flex flex-col gap-2 @md:flex-row @md:items-center"
            : "flex items-center gap-2"
        }
      >
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <Avatar name={m.name} id={m.id} placeholder={m.placeholder} />
          <div className="min-w-0 flex-1">
            <p className="truncate font-medium" title={m.name}>
              <PersonSpan name={m.name} id={m.id} />
              {m.isYou && " (you)"}
            </p>
            <p className="text-sm text-muted">
              {m.placeholder
                ? m.inviteEmail
                  ? `Invited as ${m.inviteEmail}`
                  : "Placeholder, not invited yet"
                : m.userId === props.createdBy
                  ? "Created the group"
                  : "Member"}
            </p>
          </div>
        </div>
        {(canChange || canRemove) && (
          <div
            className={
              canChange ? "flex flex-wrap gap-2 pl-12 @md:pl-0" : "flex"
            }
          >
            {canChange && (
              <button
                type="button"
                className="btn btn-secondary px-3 text-sm"
                aria-expanded={panel === "rename"}
                aria-label={`Rename ${m.name}`}
                onClick={() => toggle("rename")}
              >
                Rename
              </button>
            )}
            {canChange && (
              <button
                type="button"
                className="btn btn-secondary px-3 text-sm"
                aria-expanded={panel === "invite"}
                aria-label={`${m.inviteEmail ? "Change invite for" : "Invite"} ${m.name}`}
                onClick={() => toggle("invite")}
              >
                {m.inviteEmail ? "Change invite" : "Invite"}
              </button>
            )}
            {canRemove && (
              <button
                type="button"
                className="btn btn-ghost px-3 text-xl leading-none"
                aria-expanded={panel === "more"}
                aria-label={`More actions for ${m.name}`}
                title="More actions"
                onClick={() => toggle("more")}
              >
                ⋯
              </button>
            )}
          </div>
        )}
      </div>
      {panel === "rename" && (
        <RenameForm
          groupId={props.groupId}
          m={m}
          onCancel={() => setPanel(null)}
        />
      )}
      {panel === "invite" && (
        <InviteForm
          groupId={props.groupId}
          m={m}
          onCancel={() => setPanel(null)}
        />
      )}
      {panel === "more" &&
        (owes ? (
          <div className="mt-3 space-y-1">
            <button
              type="button"
              className="btn btn-danger w-full"
              disabled
              aria-describedby={`balance-${m.id}`}
            >
              Remove {m.name}
            </button>
            <p id={`balance-${m.id}`} className="text-sm text-muted">
              <RichText
                text={`${owes.sentence}. Settle up before removing ${m.name}.`}
                people={props.members.map((x) => ({ id: x.id, name: x.name }))}
                viewer={{ id: props.members.find((x) => x.isYou)?.id }}
              />
            </p>
          </div>
        ) : (
          <ConfirmButton
            className="mt-3"
            label={`Remove ${m.name}`}
            question={`Remove ${m.name} from the group?`}
            confirmLabel="Remove"
            onConfirm={async () => {
              await api(
                "DELETE",
                `/api/groups/${props.groupId}/members/${m.id}`,
              );
              reload(`Removed ${m.name}`);
            }}
          />
        ))}
    </li>
  );
}

/** Members list with add, rename, invite and remove; group settings for its creator. */
export default function MembersPanel(props: Props) {
  return (
    <div className="space-y-6">
      <ul className="card divide-y divide-line" aria-label="Members">
        {props.members.map((m) => (
          <MemberRow key={m.id} m={m} {...props} />
        ))}
      </ul>
      <section>
        <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
          Add someone
        </h2>
        <AddPerson groupId={props.groupId} />
      </section>
      {props.isCreator && (
        <section>
          <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase">
            Settings
          </h2>
          <Settings {...props} />
        </section>
      )}
    </div>
  );
}
