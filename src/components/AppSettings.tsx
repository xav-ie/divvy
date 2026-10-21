import { useEffect, useState } from "react";
import { api } from "../client/api.ts";
import {
  canPromptInstall,
  currentSubscription,
  disableNotifications,
  enableNotifications,
  isInstalled,
  isIos,
  onPwaChange,
  promptInstall,
  pushSupported,
} from "../client/pwa.ts";
import { toast } from "../client/toast.ts";
import { ErrorText, useAction } from "./ui.tsx";

interface Prefs {
  expenses: boolean;
  payments: boolean;
}

function Switch(props: {
  name: string;
  label: string;
  hint: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <label className="flex min-h-11 cursor-pointer items-center gap-3">
      <span className="flex-1">
        <span className="block font-medium">{props.label}</span>
        <span className="block text-sm text-muted">{props.hint}</span>
      </span>
      <input
        type="checkbox"
        role="switch"
        name={props.name}
        className="h-6 w-6 shrink-0 accent-accent"
        checked={props.checked}
        disabled={props.disabled}
        onChange={(e) => props.onChange(e.target.checked)}
      />
    </label>
  );
}

/** The release this server runs now; a page open since before a deploy shows an older one. */
const deployedVersion = async () =>
  (await api<{ version: string }>("GET", "/api/config")).version;

/** Profile's app section: install divvy, push notifications per device and per kind, and the version. */
export default function AppSettings({
  initial,
  version,
}: {
  initial: Prefs;
  /** The release this page was loaded from. */
  version: string;
}) {
  const [prefs, setPrefs] = useState(initial);
  const [installed, setInstalled] = useState(isInstalled());
  const [promptable, setPromptable] = useState(canPromptInstall());
  const [device, setDevice] = useState<boolean | null>(null);
  const install = useAction();
  const toggle = useAction();
  const save = useAction();
  const check = useAction();
  const [latest, setLatest] = useState<string | null>(null);

  useEffect(() => {
    // Quietly on open; the button reports problems.
    deployedVersion().then(setLatest, () => {});
  }, []);

  useEffect(() => {
    const update = () => {
      setInstalled(isInstalled());
      setPromptable(canPromptInstall());
      void currentSubscription().then((s) => setDevice(!!s));
    };
    update();
    return onPwaChange(update);
  }, []);

  const supported = pushSupported();
  const blocked = supported && Notification.permission === "denied";
  const deviceHint = !supported
    ? isIos() && !installed
      ? "On iPhone and iPad, add divvy to your Home Screen first."
      : "This browser can't show notifications."
    : blocked
      ? "Blocked in your browser's site settings for divvy."
      : "Pushes to this phone or computer.";

  const setPref = (kind: keyof Prefs, on: boolean) =>
    save.run(async () => {
      setPrefs((p) => ({ ...p, [kind]: on }));
      try {
        setPrefs(await api<Prefs>("PATCH", "/api/push", { [kind]: on }));
      } catch (err) {
        setPrefs((p) => ({ ...p, [kind]: !on }));
        throw err;
      }
    });

  return (
    <section className="mt-8" aria-labelledby="app-settings">
      <h2
        id="app-settings"
        className="mb-2 text-sm font-semibold tracking-wide text-muted uppercase"
      >
        App
      </h2>
      <div className="card space-y-4 p-4">
        {!installed && (
          <div>
            <p className="font-medium">Install divvy</p>
            <p className="text-sm text-muted">
              {promptable
                ? "Open it from your home screen like any other app."
                : isIos()
                  ? "Tap Share, then Add to Home Screen."
                  : "Use your browser's menu: Install app, or Add to Home Screen."}
            </p>
            {promptable && (
              <button
                type="button"
                className="btn btn-secondary mt-2 w-full"
                disabled={install.busy}
                onClick={() =>
                  install.run(async () => void (await promptInstall()))
                }
              >
                Install
              </button>
            )}
            <ErrorText>{install.error}</ErrorText>
          </div>
        )}
        <div>
          <Switch
            name="notify-device"
            label="Notifications on this device"
            hint={deviceHint}
            checked={!!device}
            disabled={device === null || !supported || blocked || toggle.busy}
            onChange={(on) =>
              toggle.run(async () => {
                if (on) await enableNotifications();
                else await disableNotifications();
                setDevice(on);
                toast(
                  on
                    ? "Notifications are on for this device"
                    : "Notifications are off for this device",
                );
              })
            }
          />
          <ErrorText>{toggle.error}</ErrorText>
        </div>
        <div className="space-y-2 border-t border-line pt-4">
          <p className="text-sm text-muted">
            Notify me, on every device, about:
          </p>
          <Switch
            name="notify-expenses"
            label="New expenses"
            hint="Someone else adds an expense you're on."
            checked={prefs.expenses}
            disabled={save.busy}
            onChange={(on) => void setPref("expenses", on)}
          />
          <Switch
            name="notify-payments"
            label="Payments"
            hint="Someone else records a payment to or from you."
            checked={prefs.payments}
            disabled={save.busy}
            onChange={(on) => void setPref("payments", on)}
          />
          <ErrorText>{save.error}</ErrorText>
        </div>
        <div className="border-t border-line pt-4">
          <p className="font-medium" data-testid="app-version">
            Version {version}
          </p>
          {latest && latest !== version ? (
            <>
              <p className="text-sm text-muted">
                Version {latest} is available.
              </p>
              <button
                type="button"
                className="btn btn-primary mt-2 w-full"
                onClick={async () => {
                  await (
                    await navigator.serviceWorker?.getRegistration()
                  )
                    ?.update()
                    .catch(() => {});
                  location.reload();
                }}
              >
                Update to {latest}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="btn btn-secondary mt-2 w-full"
              disabled={check.busy}
              onClick={() =>
                check.run(async () => {
                  const now = await deployedVersion();
                  setLatest(now);
                  if (now === version) toast("You're on the latest version");
                })
              }
            >
              Check for updates
            </button>
          )}
          <ErrorText>{check.error}</ErrorText>
        </div>
      </div>
    </section>
  );
}
