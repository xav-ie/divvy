/**
 * Copy `text`. The clipboard API needs a secure context (plain http on the
 * LAN has none), so on failure select `el` for a manual copy. True if copied.
 */
export async function copyOrSelect(
  text: string,
  el: HTMLElement | null,
): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (el) {
      const range = document.createRange();
      range.selectNodeContents(el);
      getSelection()?.removeAllRanges();
      getSelection()?.addRange(range);
    }
    return false;
  }
}
