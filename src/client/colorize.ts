/**
 * Coloring mentions: split a sentence so every known person's name — and the
 * viewer's "you"/"your" — is its own chunk, to render in their avatar hue.
 * Renderers: src/components/RichText.astro and RichText.tsx.
 */

/** Member id when known, so renames keep the color; the name is the fallback key. */
export interface PersonRef {
  id?: number;
  name: string;
}

export interface Chunk {
  text: string;
  /** Set when the text mentions this person. */
  person?: PersonRef;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Longest name wins at the same position ("Ana" doesn't split inside
 * "Anna"), a trailing "'s"/"'re" stays attached, and words that match no one
 * stay plain. Names shorter than two characters are skipped ("A" would match
 * the article), as is anyone literally named "You".
 */
export function colorize(
  text: string,
  people: PersonRef[],
  viewer?: { id?: number },
): Chunk[] {
  const byName = new Map<string, PersonRef>();
  if (viewer)
    for (const word of ["You", "you", "Your", "your", "Yours", "yours"])
      byName.set(word, { id: viewer.id, name: "" });
  for (const p of people)
    if (
      p.name.length >= 2 &&
      p.name.toLowerCase() !== "you" &&
      !byName.has(p.name)
    )
      byName.set(p.name, p);
  if (byName.size === 0) return [{ text }];
  // Alternation order is the tiebreak: longest first.
  const names = [...byName.keys()]
    .sort((a, b) => b.length - a.length)
    .map(escapeRe);
  const re = new RegExp(`\\b(${names.join("|")})(?:'s|'re)?\\b`, "g");
  const chunks: Chunk[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    const i = m.index!;
    if (i > last) chunks.push({ text: text.slice(last, i) });
    chunks.push({ text: m[0], person: byName.get(m[1]!) });
    last = i + m[0].length;
  }
  if (last < text.length) chunks.push({ text: text.slice(last) });
  return chunks;
}
