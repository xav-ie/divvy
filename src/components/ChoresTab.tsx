import { useState, type ReactNode } from "react";
import { api } from "../client/api.ts";
import { day, todayLocal } from "../client/format.ts";
import { goWithToast } from "../client/toast.ts";
import Avatar from "./Avatar.tsx";
import RichText from "./RichText.tsx";
import { ConfirmButton, ErrorText, useAction, useReveal } from "./ui.tsx";

interface Turn {
  start: string;
  end: string;
  memberId: number | null;
  swappedFrom: number | null;
}

export interface ChoreView {
  id: number;
  name: string;
  instructions: string;
  everyDays: number;
  starts: string;
  ends: string | null;
  rotation: number[];
  current: Turn | null;
  turns: Turn[];
  canEdit: boolean;
}

interface AwayView {
  id: number;
  memberId: number;
  from: string;
  until: string;
  canEdit: boolean;
}

interface Member {
  id: number;
  name: string;
  isYou: boolean;
  placeholder?: boolean;
}

const MINE_KEY = "divvy-chores-mine";

/** "Every week", "Every 2 weeks", "Every day", "Every 3 days". */
export const cadence = (days: number) =>
  days === 1
    ? "Every day"
    : days === 7
      ? "Every week"
      : days % 7 === 0
        ? `Every ${days / 7} weeks`
        : `Every ${days} days`;

const span = (t: Turn) =>
  t.start === t.end ? day(t.start) : `${day(t.start)} – ${day(t.end)}`;

/** Instructions as steps: one per line, bullets and dashes dropped. */
const steps = (text: string) =>
  text
    .split("\n")
    .map((l) => l.replace(/^\s*[-*•]\s*/, "").trim())
    .filter(Boolean);

/**
 * A group's chores: who's up now, the schedule (everyone's or just yours),
 * swapping turns, and time away. Changes reload the page.
 */
export default function ChoresTab({
  groupId,
  members,
  me,
  isCreator,
  initial,
}: {
  groupId: number;
  members: Member[];
  me: number;
  isCreator: boolean;
  initial: { chores: ChoreView[]; away: AwayView[] };
}) {
  const [mine, setMine] = useState(
    () => localStorage.getItem(MINE_KEY) === "1",
  );
  const nameOf = (id: number | null) => {
    const m = members.find((x) => x.id === id);
    return m ? (m.isYou ? "You" : m.name) : "Nobody (everyone's away)";
  };
  const people = members.map((m) => ({ id: m.id, name: m.name }));
  /** A sentence with everyone's name (and "you") in their color. */
  const say = (text: string) => (
    <RichText text={text} people={people} viewer={{ id: me }} />
  );
  const changed = (msg: string) =>
    goWithToast(location.pathname + location.search, msg);
  const pick = (on: boolean) => {
    setMine(on);
    localStorage.setItem(MINE_KEY, on ? "1" : "0");
  };

  return (
    <div className="space-y-4">
      <a
        href={`/groups/${groupId}/chores/new`}
        className="btn btn-primary w-full"
      >
        Add chore
      </a>
      {initial.chores.length === 0 ? (
        <p className="card p-4 text-muted">
          No chores yet. Add one, like dishes or trash, and divvy takes turns
          for you: everyone in order, skipping whoever is away.
        </p>
      ) : (
        <>
          <div
            className="flex gap-2"
            role="radiogroup"
            aria-label="Whose turns to show"
          >
            <button
              type="button"
              role="radio"
              aria-checked={!mine}
              className="chip"
              onClick={() => pick(false)}
            >
              Everyone
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={mine}
              className="chip"
              onClick={() => pick(true)}
            >
              Just my turns
            </button>
          </div>
          <ul className="space-y-3" aria-label="Chores">
            {initial.chores.map((c) => (
              <Chore
                key={c.id}
                c={c}
                me={me}
                mine={mine}
                isCreator={isCreator}
                members={members}
                nameOf={nameOf}
                say={say}
                groupId={groupId}
                onChanged={changed}
              />
            ))}
          </ul>
        </>
      )}
      <Away
        groupId={groupId}
        me={me}
        isCreator={isCreator}
        members={members}
        away={initial.away}
        nameOf={nameOf}
        say={say}
        onChanged={changed}
      />
    </div>
  );
}

function Chore({
  c,
  me,
  mine,
  isCreator,
  members,
  nameOf,
  say,
  groupId,
  onChanged,
}: {
  c: ChoreView;
  me: number;
  mine: boolean;
  isCreator: boolean;
  members: Member[];
  nameOf: (id: number | null) => string;
  say: (text: string) => ReactNode;
  groupId: number;
  onChanged: (msg: string) => void;
}) {
  const [swapping, setSwapping] = useState<string | null>(null);
  // Today on this device, not the server's (UTC) day.
  const today = todayLocal();
  const ahead = c.turns.filter((t) => t.end >= today);
  const shown = ahead.filter((t) => !mine || t.memberId === me);
  const howTo = steps(c.instructions);
  const now = ahead[0] && ahead[0].start <= today ? ahead[0] : null;
  const next = ahead.find((t) => !now || t.start > now.start);
  const yours = ahead.find((t) => t.memberId === me);

  return (
    <li className="card space-y-3 p-4" aria-label={c.name}>
      <div>
        <p className="flex items-baseline justify-between gap-2">
          <span className="min-w-0 break-words text-lg font-semibold">
            {c.name}
          </span>
          <span className="shrink-0 text-sm text-muted">
            {cadence(c.everyDays)}
          </span>
        </p>
        {now ? (
          <p
            className={`mt-1 font-medium ${now.memberId === me ? "text-accent" : ""}`}
          >
            {say(
              now.memberId === me
                ? `You're up until ${day(now.end)}`
                : `Now: ${nameOf(now.memberId)}, until ${day(now.end)}`,
            )}
          </p>
        ) : next ? (
          <p className="mt-1 font-medium">Starts {day(next.start)}</p>
        ) : (
          <p className="mt-1 text-muted">
            No more turns: the last one is over.
          </p>
        )}
        <p className="text-sm text-muted">
          {say(
            [
              next && now
                ? `Next: ${nameOf(next.memberId)}, ${day(next.start)}`
                : "",
              yours && yours !== now
                ? `Your next turn: ${day(yours.start)}`
                : "",
            ]
              .filter(Boolean)
              .join(" · "),
          )}
        </p>
      </div>

      {howTo.length > 0 && (
        <details className="rounded-xl border border-line" open>
          <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">
            What to do
          </summary>
          <ul className="list-disc space-y-1 px-3 pb-3 pl-8">
            {howTo.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </details>
      )}

      <details className="rounded-xl border border-line">
        <summary className="flex min-h-11 cursor-pointer items-center px-3 font-medium">
          {mine ? "Your turns" : "Schedule"} ({shown.length})
        </summary>
        {shown.length === 0 ? (
          <p className="px-3 pb-3 text-muted">
            {mine ? "You have no turns in the next year." : "No turns ahead."}
          </p>
        ) : (
          <ul
            className="divide-y divide-line"
            aria-label={`${c.name} schedule`}
          >
            {shown.map((t) => (
              <TurnRow
                key={t.start}
                c={c}
                t={t}
                now={now}
                me={me}
                isCreator={isCreator}
                members={members}
                nameOf={nameOf}
                say={say}
                open={swapping === t.start}
                onOpen={(on) => setSwapping(on ? t.start : null)}
                onChanged={onChanged}
              />
            ))}
          </ul>
        )}
      </details>

      {c.canEdit && (
        <div className="flex flex-wrap gap-2">
          <a
            href={`/groups/${groupId}/chores/${c.id}`}
            className="btn btn-secondary px-3 text-sm"
          >
            Edit
          </a>
          <ConfirmButton
            compact
            className="ml-auto"
            label="Delete"
            question={`Delete the chore "${c.name}" and its schedule?`}
            onConfirm={async () => {
              await api("DELETE", `/api/chores/${c.id}`);
              onChanged(`Deleted ${c.name}`);
            }}
          />
        </div>
      )}
    </li>
  );
}

function TurnRow({
  c,
  t,
  now,
  me,
  isCreator,
  members,
  nameOf,
  say,
  open,
  onOpen,
  onChanged,
}: {
  c: ChoreView;
  t: Turn;
  now: Turn | null;
  me: number;
  isCreator: boolean;
  members: Member[];
  nameOf: (id: number | null) => string;
  say: (text: string) => ReactNode;
  open: boolean;
  onOpen: (on: boolean) => void;
  onChanged: (msg: string) => void;
}) {
  const { busy, error, run } = useAction();
  const reveal = useReveal<HTMLDivElement>(open);
  const isNow = now?.start === t.start;
  const canSwap = t.memberId !== null && (t.memberId === me || isCreator);
  const idx = c.turns.indexOf(t);
  // Who could take it: anyone else with a later turn to give back.
  const options = members
    .filter((m) => m.id !== t.memberId)
    .map((m) => ({
      m,
      later: c.turns.slice(idx + 1).find((x) => x.memberId === m.id),
    }))
    .filter((o) => o.later);
  const whose = t.memberId === me ? "your" : `${nameOf(t.memberId)}'s`;

  return (
    <li
      className={`px-3 py-2 ${isNow ? "bg-accent-soft" : ""}`}
      aria-label={`${span(t)}: ${nameOf(t.memberId)}`}
    >
      <div className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-muted">
            {span(t)}
            {isNow ? " · now" : ""}
          </span>
          <span className="block font-medium">
            {say(nameOf(t.memberId))}
            {t.swappedFrom !== null && (
              <span className="font-normal text-muted">
                {" "}
                {say(
                  `(swapped with ${t.swappedFrom === me ? "you" : nameOf(t.swappedFrom)})`,
                )}
              </span>
            )}
          </span>
        </span>
        {canSwap && options.length > 0 && !open && (
          <button
            type="button"
            className="btn btn-secondary px-3 text-sm"
            aria-label={`Swap ${whose} turn ${span(t)}`}
            onClick={() => onOpen(true)}
          >
            Swap
          </button>
        )}
      </div>
      {open && (
        <div
          ref={reveal}
          className="mt-2 space-y-2 rounded-xl border border-accent p-3"
          role="group"
          aria-label={`Swap ${whose} turn`}
        >
          <p className="text-sm">
            {say(
              `Who takes ${whose} turn? They get it, and ${t.memberId === me ? "you take" : `${nameOf(t.memberId)} takes`} their next turn after it.`,
            )}
          </p>
          <ul className="space-y-2">
            {options.map(({ m, later }) => (
              <li key={m.id}>
                <button
                  type="button"
                  className="btn btn-secondary w-full justify-start gap-2 text-left"
                  disabled={busy}
                  onClick={() =>
                    run(async () => {
                      await api("POST", `/api/chores/${c.id}/swap`, {
                        turnStart: t.start,
                        memberId: m.id,
                      });
                      onChanged(
                        `Swapped: ${m.isYou ? "you take" : `${m.name} takes`} ${day(t.start)}`,
                      );
                    })
                  }
                >
                  <Avatar
                    name={m.name}
                    id={m.id}
                    placeholder={m.placeholder}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    {say(m.isYou ? "You" : m.name)}
                    <span className="block text-sm font-normal text-muted">
                      gives back {day(later!.start)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
          <button
            type="button"
            className="btn btn-secondary w-full"
            disabled={busy}
            onClick={() => onOpen(false)}
          >
            Cancel
          </button>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </li>
  );
}

function Away({
  groupId,
  me,
  isCreator,
  members,
  away,
  nameOf,
  say,
  onChanged,
}: {
  groupId: number;
  me: number;
  isCreator: boolean;
  members: Member[];
  away: AwayView[];
  nameOf: (id: number | null) => string;
  say: (text: string) => ReactNode;
  onChanged: (msg: string) => void;
}) {
  const today = todayLocal();
  const [adding, setAdding] = useState(false);
  const [who, setWho] = useState(me);
  const [from, setFrom] = useState(today);
  const [until, setUntil] = useState("");
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useAction();
  const reveal = useReveal<HTMLDivElement>(adding);
  const untilError =
    tried && !(until > from)
      ? "Pick the day they're back, after they leave"
      : "";
  // Only the group's creator can mark someone else away.
  const choices = isCreator ? members : members.filter((m) => m.id === me);

  return (
    <section className="card space-y-3 p-4" aria-labelledby="away-h">
      <h2 id="away-h" className="font-semibold">
        Time away
      </h2>
      <p className="text-sm text-muted">
        Turns that start while someone is away go to the next person instead.
      </p>
      {away.length > 0 && (
        <ul className="divide-y divide-line" aria-label="Time away">
          {away.map((a) => (
            <li
              key={a.id}
              className="flex min-h-11 flex-wrap items-center gap-2 py-2"
            >
              <span className="min-w-0 flex-1">
                <span className="block font-medium">
                  {say(a.memberId === me ? "You" : nameOf(a.memberId))}
                </span>
                <span className="block text-sm text-muted">
                  {a.from <= today ? "Away now" : `Away from ${day(a.from)}`},
                  back {day(a.until)}
                </span>
              </span>
              {a.canEdit && (
                <ConfirmButton
                  compact
                  label="Remove"
                  name={`Remove ${nameOf(a.memberId)}'s time away`}
                  question={`Remove ${a.memberId === me ? "your" : `${nameOf(a.memberId)}'s`} time away? Their turns come back.`}
                  onConfirm={async () => {
                    await api("DELETE", `/api/away/${a.id}`);
                    onChanged("Time away removed");
                  }}
                />
              )}
            </li>
          ))}
        </ul>
      )}
      {!adding ? (
        <button
          type="button"
          className="btn btn-secondary w-full"
          onClick={() => setAdding(true)}
        >
          Add time away
        </button>
      ) : (
        <div
          ref={reveal}
          className="space-y-3"
          role="group"
          aria-label="Add time away"
        >
          {choices.length > 1 && (
            <div>
              <p className="label">Who's away</p>
              <div
                className="flex flex-wrap gap-2"
                role="radiogroup"
                aria-label="Who's away"
              >
                {choices.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    role="radio"
                    aria-checked={who === m.id}
                    className="chip"
                    title={m.isYou ? "You" : m.name}
                    onClick={() => setWho(m.id)}
                  >
                    <Avatar
                      name={m.name}
                      id={m.id}
                      placeholder={m.placeholder}
                      size="sm"
                    />
                    <span className="truncate">
                      {say(m.isYou ? "You" : m.name)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label htmlFor="away-from" className="label">
                Away from
              </label>
              <input
                id="away-from"
                type="date"
                className="input"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="away-until" className="label">
                Back on
              </label>
              <input
                id="away-until"
                type="date"
                className="input"
                value={until}
                min={from}
                aria-invalid={untilError ? true : undefined}
                onChange={(e) => setUntil(e.target.value)}
              />
            </div>
          </div>
          {untilError && <p className="error">{untilError}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              className="btn btn-secondary flex-1"
              disabled={busy}
              onClick={() => setAdding(false)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary flex-1"
              disabled={busy}
              onClick={() => {
                setTried(true);
                if (!(until > from)) return;
                void run(async () => {
                  await api("POST", `/api/groups/${groupId}/away`, {
                    memberId: who,
                    from,
                    until,
                  });
                  onChanged(
                    `${who === me ? "You're" : `${nameOf(who)} is`} away until ${day(until)}`,
                  );
                });
              }}
            >
              {busy ? "Saving…" : "Save"}
            </button>
          </div>
          <ErrorText>{error}</ErrorText>
        </div>
      )}
    </section>
  );
}
