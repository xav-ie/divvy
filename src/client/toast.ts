import { api, errorMessage } from "./api.ts";
import { leave } from "./leave.ts";

const FLASH_KEY = "divvy-flash";

/** Undo a delete: POST to the restore `url`, then reload showing `done`. */
export interface Undo {
  url: string;
  done: string;
}

/** Show a short message, with an Undo button or a View link when given one. */
export function toast(message: string, undo?: Undo, link?: string): void {
  const host = document.getElementById("toasts");
  if (!host) return;
  const el = document.createElement("div");
  el.className =
    "pointer-events-auto flex min-h-11 items-center gap-3 rounded-xl bg-fg px-4 py-2 text-bg shadow-lg";
  el.setAttribute("role", "status");
  const text = document.createElement("span");
  text.className = "flex-1";
  text.textContent = message;
  el.appendChild(text);
  if (undo) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "min-h-11 px-2 font-semibold underline";
    button.textContent = "Undo";
    button.onclick = async () => {
      button.disabled = true;
      try {
        await api("POST", undo.url);
        goWithToast(location.pathname + location.search, undo.done);
      } catch (err) {
        text.textContent = `Couldn't undo: ${errorMessage(err)}`;
        button.remove();
      }
    };
    el.appendChild(button);
  }
  if (link) {
    const a = document.createElement("a");
    a.href = link;
    a.className = "flex min-h-11 items-center px-2 font-semibold underline";
    a.textContent = "View";
    el.appendChild(a);
  }
  host.replaceChildren(el);
  setTimeout(() => el.remove(), undo ? 10000 : 4000);
}

/** Show `message` (and its Undo or View link) after navigating to `url`. */
export function goWithToast(
  url: string,
  message: string,
  undo?: Undo,
  link?: string,
): void {
  sessionStorage.setItem(FLASH_KEY, JSON.stringify({ message, undo, link }));
  leave(url);
}

/** Show a toast left by goWithToast on the previous page. */
export function showFlash(): void {
  const raw = sessionStorage.getItem(FLASH_KEY);
  if (!raw) return;
  sessionStorage.removeItem(FLASH_KEY);
  const { message, undo, link } = JSON.parse(raw) as {
    message: string;
    undo?: Undo;
    link?: string;
  };
  toast(message, undo, link);
}
