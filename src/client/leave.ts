import { navigate } from "astro:transitions/client";

let leaving = false;

/** True once the page is navigating away on purpose (after a save), so guards and busy states stand down. */
export const isLeaving = (): boolean => leaving;

/** Navigate without the unsaved-changes guard (a client-side swap, like a link). */
export function leave(url: string): void {
  leaving = true;
  void navigate(url);
}

// Client modules outlive client-side navigations: each new page starts fresh.
// (Also imported while rendering on the server, where there's no document.)
if (typeof document !== "undefined")
  document.addEventListener("astro:page-load", () => {
    leaving = false;
  });
