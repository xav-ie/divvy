import { hueFor } from "../client/hue.ts";

/** "Ana" -> "A", "Ana Lopez" -> "AL". */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words.at(-1)!] : words;
  return letters.map((w) => [...w][0]!.toUpperCase()).join("") || "?";
}

const SIZES = {
  sm: "h-8 w-8 text-xs",
  md: "h-9 w-9 text-sm",
  lg: "h-12 w-12 text-lg",
} as const;

/** Decorative initials circle; the name next to it stays the accessible text. */
export default function Avatar({
  name,
  id,
  placeholder = false,
  size = "md",
}: {
  name: string;
  /** Member id when known, so renames keep the color. */
  id?: number;
  /** Not signed up yet: dashed outline. */
  placeholder?: boolean;
  size?: keyof typeof SIZES;
}) {
  return (
    <span
      aria-hidden="true"
      className={`avatar ${placeholder ? "avatar-placeholder" : ""} ${SIZES[size]}`}
      style={{ "--hue": hueFor(id ?? name) } as React.CSSProperties}
    >
      {initials(name)}
    </span>
  );
}
