import { useRef, useState } from "react";
import { api } from "../client/api.ts";
import { toast } from "../client/toast.ts";
import Avatar from "./Avatar.tsx";
import { ErrorText, Field, useAction } from "./ui.tsx";

interface Me {
  id: number;
  name: string;
  memberId: number;
  venmo: string | null;
  venmoStatus: "found" | "not_found" | "unavailable" | null;
  hasVenmoAvatar: boolean;
}

interface Preview {
  previewId: string;
  username: string;
  link: string;
  photoUrl: string | null;
  found: boolean | null;
  note: string | null;
}

/** A photo divvy serves (never Venmo's own URL), or the initials avatar. */
function Face({ me, src, alt }: { me: Me; src: string | null; alt: string }) {
  return src ? (
    <img
      src={src}
      alt={alt}
      className="h-12 w-12 shrink-0 rounded-full object-cover"
      data-testid="venmo-photo"
    />
  ) : (
    <Avatar name={me.name} id={me.memberId} size="lg" />
  );
}

const OpenInVenmo = ({ link }: { link: string }) => (
  <a
    className="btn btn-secondary flex-1"
    href={link}
    target="_blank"
    rel="noopener noreferrer"
  >
    Open in Venmo
  </a>
);

/**
 * The acting user's Venmo username. A new one is checked on Venmo first and
 * confirmed on an "Is this you?" card; only then is it saved, with its photo.
 */
export default function VenmoUsername({ me: initial }: { me: Me }) {
  const [me, setMe] = useState(initial);
  const [venmo, setVenmo] = useState(initial.venmo ?? "");
  const [preview, setPreview] = useState<Preview | null>(null);
  // One step at a time: the field (no saved username, or "Change"), then the
  // confirm card, then the saved card.
  const [editing, setEditing] = useState(!initial.venmo);
  const checked = useRef("");
  const check = useAction();
  const save = useAction();
  const refresh = useAction();
  const [photoVersion, setPhotoVersion] = useState(0);
  const input = useRef<HTMLDivElement>(null);
  const typed = venmo.trim().replace(/^@/, "");

  const inFlight = useRef(false);
  const runCheck = () => {
    // Blur and the Check button can fire together; check once.
    if (inFlight.current) return;
    inFlight.current = true;
    return check
      .run(async () => {
        if (!typed) {
          if (!me.venmo) return;
          // Clearing needs no confirm.
          setMe(await api<Me>("PATCH", "/api/me", { venmo: null }));
          setEditing(true);
          toast("Venmo username removed");
          return;
        }
        checked.current = typed;
        setPreview(
          await api<Preview>("POST", "/api/me/venmo/preview", { venmo: typed }),
        );
      })
      .finally(() => {
        inFlight.current = false;
      });
  };

  return (
    <div className="mt-6 space-y-3">
      {editing && !preview && (
        <form
          className="card space-y-3 p-4"
          aria-label="Venmo"
          onSubmit={(e) => {
            e.preventDefault();
            void runCheck();
          }}
        >
          <div ref={input}>
            <Field
              label="Venmo username"
              value={venmo}
              placeholder="@your-name"
              autoComplete="off"
              autoCapitalize="none"
              spellCheck={false}
              maxLength={31}
              onChange={(e) => {
                setVenmo(e.target.value);
                setPreview(null);
              }}
              onBlur={() => {
                // Check on leaving the field, once per new value.
                if (typed && typed !== me.venmo && typed !== checked.current)
                  void runCheck();
              }}
            />
          </div>
          <p className="text-sm text-muted">
            {me.venmo
              ? "People who owe you see a button to pay you on Venmo."
              : "Add your Venmo username so roommates can pay you in one tap."}
          </p>
          <div className="flex gap-2">
            {me.venmo && (
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => {
                  setVenmo(me.venmo ?? "");
                  setEditing(false);
                }}
              >
                Cancel
              </button>
            )}
            {typed !== (me.venmo ?? "") && (
              <button className="btn btn-primary flex-1" disabled={check.busy}>
                {check.busy ? "Checking…" : typed ? "Check" : "Remove"}
              </button>
            )}
          </div>
          <ErrorText>{check.error}</ErrorText>
        </form>
      )}

      {preview ? (
        <section className="card space-y-3 p-4" aria-label="Is this you?">
          <h2 className="font-semibold">Is this you?</h2>
          <div className="flex items-center gap-3">
            <Face
              me={me}
              src={preview.photoUrl}
              alt={`@${preview.username} on Venmo`}
            />
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">@{preview.username}</p>
              <p className="truncate text-sm text-muted">
                venmo.com/{preview.username}
              </p>
            </div>
          </div>
          {preview.note && (
            <p
              className={
                preview.found !== true ? "error" : "text-sm text-muted"
              }
              role={preview.found !== true ? "alert" : undefined}
            >
              {preview.note}
            </p>
          )}
          <div className="flex gap-2">
            <OpenInVenmo link={preview.link} />
            <button
              type="button"
              className="btn btn-secondary flex-1"
              disabled={save.busy}
              onClick={() => {
                setPreview(null);
                input.current?.querySelector("input")?.focus();
              }}
            >
              No, edit
            </button>
          </div>
          {/* Only a username Venmo confirmed can be saved. */}
          {preview.found === true && (
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={save.busy}
              onClick={() =>
                save.run(async () => {
                  const u = await api<Me>("PATCH", "/api/me", {
                    venmo: preview.username,
                    previewId: preview.previewId,
                  });
                  setMe(u);
                  setVenmo(u.venmo ?? "");
                  setPreview(null);
                  setEditing(false);
                  toast(`Venmo username saved: @${u.venmo}`);
                })
              }
            >
              {save.busy ? "Saving…" : "Yes, save"}
            </button>
          )}
          {preview.found === null && (
            <button
              type="button"
              className="btn btn-primary w-full"
              disabled={check.busy}
              onClick={() => void runCheck()}
            >
              {check.busy ? "Checking…" : "Try again"}
            </button>
          )}
          <ErrorText>{save.error}</ErrorText>
        </section>
      ) : (
        !editing &&
        me.venmo && (
          <section className="card space-y-3 p-4" aria-label="Your Venmo">
            <div className="flex items-center gap-3">
              <Face
                me={me}
                src={
                  me.hasVenmoAvatar
                    ? `/api/users/${me.id}/venmo-avatar?v=${photoVersion}`
                    : null
                }
                alt={`@${me.venmo} on Venmo`}
              />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium">@{me.venmo}</p>
                <p className="truncate text-sm text-muted">
                  venmo.com/{me.venmo}
                </p>
              </div>
            </div>
            {me.venmoStatus === "not_found" ? (
              <p className="error" role="alert">
                We couldn't find @{me.venmo} on Venmo; check the spelling.
              </p>
            ) : (
              !me.hasVenmoAvatar && (
                <p className="text-sm text-muted">
                  Couldn't load your Venmo photo; your link still works.
                </p>
              )
            )}
            <div className="flex gap-2">
              <OpenInVenmo
                link={`https://venmo.com/${encodeURIComponent(me.venmo)}`}
              />
              <button
                type="button"
                className="btn btn-secondary flex-1"
                disabled={refresh.busy}
                onClick={() =>
                  refresh.run(async () => {
                    setMe(await api<Me>("POST", "/api/me/venmo/refresh"));
                    setPhotoVersion((v) => v + 1);
                  })
                }
              >
                {refresh.busy ? "Checking…" : "Refresh"}
              </button>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                className="btn btn-secondary flex-1"
                onClick={() => {
                  setVenmo(me.venmo ?? "");
                  setEditing(true);
                }}
              >
                Change
              </button>
              <button
                type="button"
                className="btn btn-secondary flex-1"
                disabled={check.busy}
                onClick={() =>
                  check.run(async () => {
                    setMe(await api<Me>("PATCH", "/api/me", { venmo: null }));
                    setVenmo("");
                    setEditing(true);
                    toast("Venmo username removed");
                  })
                }
              >
                Remove
              </button>
            </div>
            <ErrorText>{refresh.error ?? check.error}</ErrorText>
          </section>
        )
      )}
    </div>
  );
}
