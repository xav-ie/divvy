import { useEffect, useState } from "react";
import {
  canPromptInstall,
  currentSubscription,
  enableNotifications,
  isInstalled,
  isIos,
  onPwaChange,
  promptInstall,
  pushSupported,
} from "../client/pwa.ts";
import { toast } from "../client/toast.ts";
import { ErrorText, useAction } from "./ui.tsx";

const INSTALL_KEY = "divvy-install-dismissed";
const NOTIFY_KEY = "divvy-notify-dismissed";

type Offer = "install" | "ios" | "notify" | null;

/** What to offer on this device: install in a browser tab, notifications once installed. */
async function pick(): Promise<Offer> {
  if (isInstalled()) {
    if (localStorage.getItem(NOTIFY_KEY) || !pushSupported()) return null;
    if (Notification.permission !== "default") return null;
    return (await currentSubscription()) ? null : "notify";
  }
  if (localStorage.getItem(INSTALL_KEY)) return null;
  if (canPromptInstall()) return "install";
  return isIos() ? "ios" : null;
}

/** Home's dismissible offer to install divvy, then to turn on notifications. */
export default function InstallBanner() {
  const [offer, setOffer] = useState<Offer>(null);
  const { busy, error, run } = useAction();
  useEffect(() => {
    const update = () => void pick().then(setOffer);
    update();
    return onPwaChange(update);
  }, []);
  if (!offer) return null;

  const dismiss = () => {
    localStorage.setItem(offer === "notify" ? NOTIFY_KEY : INSTALL_KEY, "1");
    setOffer(null);
  };
  const [title, text] = {
    install: [
      "Install divvy",
      "Open it from your home screen like any other app.",
    ],
    ios: [
      "Add divvy to your Home Screen",
      "Tap Share, then Add to Home Screen. Installed, divvy can also notify you.",
    ],
    notify: [
      "Turn on notifications",
      "Hear when someone adds an expense you're on or a payment to or from you.",
    ],
  }[offer];

  return (
    <section
      className="card mt-6 p-4"
      aria-labelledby="install-banner"
      data-testid="install-banner"
    >
      <h2 id="install-banner" className="font-semibold">
        {title}
      </h2>
      <p className="mt-1 text-sm text-muted">{text}</p>
      <div className="mt-3 flex gap-2">
        {offer !== "ios" && (
          <button
            type="button"
            className="btn btn-primary flex-1"
            disabled={busy}
            onClick={() =>
              run(async () => {
                if (offer === "install") {
                  await promptInstall();
                } else {
                  await enableNotifications();
                  toast("Notifications are on for this device");
                }
              })
            }
          >
            {offer === "install" ? "Install" : "Turn on"}
          </button>
        )}
        <button
          type="button"
          className="btn btn-secondary flex-1"
          onClick={dismiss}
        >
          {offer === "ios" ? "Got it" : "Not now"}
        </button>
      </div>
      <ErrorText>{error}</ErrorText>
    </section>
  );
}
