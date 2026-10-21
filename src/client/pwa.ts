import { api } from "./api.ts";

/** Chrome's install prompt event (not in lib.dom). */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: BeforeInstallPromptEvent | null = null;
const CHANGED = "divvy:pwa";
const changed = () => dispatchEvent(new Event(CHANGED));

// Imported by the layout, so these listen from the first page load on.
addEventListener("beforeinstallprompt", (e) => {
  // Keep the browser's own mini bar away; divvy offers its own button.
  e.preventDefault();
  deferred = e as BeforeInstallPromptEvent;
  changed();
});
addEventListener("appinstalled", () => {
  deferred = null;
  changed();
});

/** Run `fn` whenever install or notification state may have changed; returns the unsubscribe. */
export function onPwaChange(fn: () => void): () => void {
  addEventListener(CHANGED, fn);
  return () => removeEventListener(CHANGED, fn);
}

/** Running as the installed app rather than in a browser tab. */
export const isInstalled = () =>
  // Android opens it fullscreen; iOS has no fullscreen and falls back to standalone.
  matchMedia("(display-mode: fullscreen), (display-mode: standalone)")
    .matches || (navigator as { standalone?: boolean }).standalone === true;

/** iPhone and iPad (iPadOS reports itself as a Mac with touch). */
export const isIos = () =>
  /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** The browser handed over its install prompt (Chrome, Edge, Android). */
export const canPromptInstall = () => deferred !== null;

/** Show the browser's install dialog; true if they installed. */
export async function promptInstall(): Promise<boolean> {
  if (!deferred) return false;
  const e = deferred;
  deferred = null;
  await e.prompt();
  const { outcome } = await e.userChoice;
  changed();
  return outcome === "accepted";
}

/** Push works here (on iOS only once installed). */
export const pushSupported = () =>
  "serviceWorker" in navigator &&
  "PushManager" in window &&
  "Notification" in window;

/** This device's push subscription, if notifications are on for it. */
export async function currentSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

const fromB64u = (s: string) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(bin, (c) => c.charCodeAt(0));
};

/**
 * Ask for permission (it must follow a tap), subscribe this device and
 * register it with divvy. Throws with a message to show when it can't.
 */
export async function enableNotifications(): Promise<void> {
  if (!pushSupported())
    throw new Error(
      isIos() && !isInstalled()
        ? "Add divvy to your Home Screen first; iPhone and iPad only notify installed apps"
        : "This browser can't show notifications",
    );
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error(
      "Notifications are blocked for divvy; allow them in your browser's site settings",
    );
  const { publicKey } = await api<{ publicKey: string }>("GET", "/api/push");
  const reg = await navigator.serviceWorker.ready;
  const sub =
    (await reg.pushManager.getSubscription()) ??
    (await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: fromB64u(publicKey),
    }));
  await api("POST", "/api/push/subscriptions", sub.toJSON());
  changed();
}

/** Stop notifications on this device. */
export async function disableNotifications(): Promise<void> {
  const sub = await currentSubscription();
  if (!sub) return;
  await api(
    "DELETE",
    `/api/push/subscriptions?endpoint=${encodeURIComponent(sub.endpoint)}`,
  );
  await sub.unsubscribe();
  changed();
}
