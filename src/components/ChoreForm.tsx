import { useEffect, useState } from "react";
import { api, errorMessage } from "../client/api.ts";
import { todayLocal } from "../client/format.ts";
import { goWithToast } from "../client/toast.ts";
import { addDays } from "../domain/chores.ts";
import Avatar from "./Avatar.tsx";
import { day } from "../client/format.ts";
import { cadence, type ChoreView } from "./ChoresTab.tsx";
import RichText from "./RichText.tsx";
import {
  ErrorText,
  Field,
  NAME_MAX,
  Skeleton,
  useAction,
  useLeaveGuard,
} from "./ui.tsx";

interface Member {
  id: number;
  name: string;
  isYou: boolean;
  placeholder?: boolean;
}

interface FormState {
  name: string;
  instructions: string;
  everyDays: number;
  starts: string;
  ends: string;
  rotation: number[];
}

const label = (m: Member) => (m.isYou ? "You" : m.name);
const LENGTHS = [1, 2, 3, 7, 14, 21, 28];

/** Create or edit a chore: what to do, how long a turn is, and the order people take turns. */
export default function ChoreForm({
  groupId,
  members,
  choreId,
}: {
  groupId: number;
  members: Member[];
  /** Present when editing; the chore is loaded from the group's list. */
  choreId?: number;
}) {
  const [f, setF] = useState<FormState | null>(
    choreId
      ? null
      : {
          name: "",
          instructions: "",
          everyDays: 7,
          starts: todayLocal(),
          ends: "",
          rotation: members.map((m) => m.id),
        },
  );
  const [loadError, setLoadError] = useState("");
  const [initial, setInitial] = useState(() => JSON.stringify(f));
  const guard = useLeaveGuard(JSON.stringify(f) !== initial);
  const [tried, setTried] = useState(false);
  const { busy, error, run } = useAction();

  useEffect(() => {
    if (!choreId) return;
    api<{ chores: ChoreView[] }>("GET", `/api/groups/${groupId}/chores`)
      .then(({ chores }) => {
        const c = chores.find((x) => x.id === choreId);
        if (!c) return setLoadError("That chore doesn't exist anymore");
        const loaded = {
          name: c.name,
          instructions: c.instructions,
          everyDays: c.everyDays,
          starts: c.starts,
          ends: c.ends ?? "",
          rotation: c.rotation,
        };
        setF(loaded);
        setInitial(JSON.stringify(loaded));
      })
      .catch((err) => setLoadError(errorMessage(err)));
  }, [groupId, choreId]);

  if (loadError) return <ErrorText>{loadError}</ErrorText>;
  if (!f) return <Skeleton rows={4} />;
  const set = (p: Partial<FormState>) => setF({ ...f, ...p });
  const byId = new Map(members.map((m) => [m.id, m]));
  const people = members.map((m) => ({ id: m.id, name: m.name }));
  const me = members.find((m) => m.isYou)?.id;
  const inRotation = f.rotation.filter((id) => byId.has(id));
  const out = members.filter((m) => !f.rotation.includes(m.id));
  const move = (i: number, by: number) => {
    const r = [...inRotation];
    [r[i], r[i + by]] = [r[i + by]!, r[i]!];
    set({ rotation: r });
  };
  const nameError = tried && !f.name.trim() ? "Give the chore a name" : "";
  const rotationError =
    tried && inRotation.length === 0 ? "Pick at least one person" : "";
  const endsError =
    tried && f.ends && f.ends < f.starts
      ? "The last turn can't start before the first"
      : "";
  const lengths = LENGTHS.includes(f.everyDays)
    ? LENGTHS
    : [...LENGTHS, f.everyDays].sort((a, b) => a - b);
  const firstEnd = addDays(f.starts, f.everyDays - 1);

  return (
    <form
      noValidate
      aria-label={choreId ? "Edit chore" : "New chore"}
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (
          !f.name.trim() ||
          inRotation.length === 0 ||
          (f.ends && f.ends < f.starts)
        )
          return;
        run(async () => {
          const body = {
            name: f.name,
            instructions: f.instructions,
            everyDays: f.everyDays,
            starts: f.starts,
            ends: f.ends || null,
            rotation: inRotation,
          };
          if (choreId) await api("PATCH", `/api/chores/${choreId}`, body);
          else await api("POST", `/api/groups/${groupId}/chores`, body);
          goWithToast(
            `/groups/${groupId}?tab=chores`,
            `Saved ${f.name.trim()}`,
          );
        });
      }}
    >
      <div className="space-y-5">
        <Field
          label="Name"
          value={f.name}
          placeholder="e.g. Dishes"
          maxLength={NAME_MAX}
          error={nameError}
          onChange={(e) => set({ name: e.target.value })}
        />
        <div>
          <label htmlFor="chore-steps" className="label">
            What to do (one step per line)
          </label>
          <textarea
            id="chore-steps"
            className="input min-h-28"
            maxLength={2000}
            placeholder={
              "Load dishes left in the sink\nRun the dishwasher when it's full"
            }
            value={f.instructions}
            onChange={(e) => set({ instructions: e.target.value })}
          />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label htmlFor="chore-starts" className="label">
              First turn starts
            </label>
            <input
              id="chore-starts"
              type="date"
              className="input"
              value={f.starts}
              onChange={(e) =>
                e.target.value && set({ starts: e.target.value })
              }
            />
          </div>
          <div>
            <label htmlFor="chore-every" className="label">
              Each turn lasts
            </label>
            <select
              id="chore-every"
              className="input"
              value={f.everyDays}
              onChange={(e) => set({ everyDays: Number(e.target.value) })}
            >
              {lengths.map((d) => (
                <option key={d} value={d}>
                  {d === 1
                    ? "1 day"
                    : d % 7 === 0
                      ? `${d / 7} week${d > 7 ? "s" : ""}`
                      : `${d} days`}
                </option>
              ))}
            </select>
          </div>
        </div>
        <p className="-mt-3 text-sm text-muted">
          {cadence(f.everyDays)}: the first turn is{" "}
          {f.everyDays === 1
            ? day(f.starts)
            : `${day(f.starts)} – ${day(firstEnd)}`}
          .
        </p>
        <div>
          <label htmlFor="chore-ends" className="label">
            Last turn starts by (optional)
          </label>
          <input
            id="chore-ends"
            type="date"
            className="input"
            value={f.ends}
            min={f.starts}
            aria-invalid={endsError ? true : undefined}
            onChange={(e) => set({ ends: e.target.value })}
          />
          {endsError && <p className="error mt-1">{endsError}</p>}
          <p className="mt-1 text-sm text-muted">
            Leave empty to keep going, or set the day your lease ends.
          </p>
        </div>
        <div>
          <p className="label">Order of turns</p>
          {inRotation.length > 0 && (
            <ol
              className="card divide-y divide-line"
              aria-label="Order of turns"
            >
              {inRotation.map((id, i) => {
                const m = byId.get(id)!;
                return (
                  <li key={id} className="flex items-center gap-2 px-3 py-1">
                    <span className="w-5 text-sm text-muted">{i + 1}</span>
                    <Avatar
                      name={m.name}
                      id={m.id}
                      placeholder={m.placeholder}
                      size="sm"
                    />
                    <span className="min-w-0 flex-1 truncate">
                      <RichText
                        text={label(m)}
                        people={people}
                        viewer={{ id: me }}
                      />
                    </span>
                    <button
                      type="button"
                      className="btn btn-ghost h-11 w-11 p-0"
                      aria-label={`Move ${label(m)} earlier`}
                      disabled={i === 0}
                      onClick={() => move(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost h-11 w-11 p-0"
                      aria-label={`Move ${label(m)} later`}
                      disabled={i === inRotation.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost h-11 w-11 p-0"
                      aria-label={`Take ${label(m)} out`}
                      onClick={() =>
                        set({ rotation: inRotation.filter((x) => x !== id) })
                      }
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ol>
          )}
          {rotationError && <p className="error mt-1">{rotationError}</p>}
          {out.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {out.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className="chip"
                  title={label(m)}
                  aria-label={`Add ${label(m)}`}
                  onClick={() => set({ rotation: [...inRotation, m.id] })}
                >
                  +{" "}
                  <span className="truncate">
                    <RichText
                      text={label(m)}
                      people={people}
                      viewer={{ id: me }}
                    />
                  </span>
                </button>
              ))}
            </div>
          )}
          <p className="mt-1 text-sm text-muted">
            The first person takes the first turn. To pair chores (dishes, then
            trash right after), give both the same order and start the second
            one on the last day of the first one's first turn.
          </p>
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
