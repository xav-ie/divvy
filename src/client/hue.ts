/** Hues spread around the wheel, skipping the teal of the accent; light and dark tints in global.css keep them AA. */
const HUES = [8, 32, 88, 145, 55, 205, 238, 275, 312, 340];

/** The same person always gets the same hue (FNV-1a over their member id or name). */
export function hueFor(key: string | number): number {
  let h = 0x811c9dc5;
  for (const ch of String(key)) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193);
  }
  return HUES[(h >>> 0) % HUES.length]!;
}
