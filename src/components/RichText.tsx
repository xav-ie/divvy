import type { ReactNode } from "react";
import { colorize, type PersonRef } from "../client/colorize.ts";
import { hueFor } from "../client/hue.ts";

const hueStyle = (p: PersonRef) =>
  ({ "--hue": hueFor(p.id ?? p.name) }) as React.CSSProperties;

/** A person's name in their avatar hue (see .person in global.css). */
export function PersonSpan({
  name,
  id,
  className,
}: {
  name: string;
  id?: number;
  className?: string;
}) {
  return (
    <span
      className={className ? `person ${className}` : "person"}
      style={hueStyle({ name, id })}
    >
      {name}
    </span>
  );
}

/** Text with every person's name inside colored in their hue. */
export default function RichText({
  text,
  people = [],
  viewer,
}: {
  text: string;
  people?: PersonRef[];
  viewer?: { id?: number };
}): ReactNode {
  return colorize(text, people, viewer).map((c, i) =>
    c.person ? (
      <span key={i} className="person" style={hueStyle(c.person)}>
        {c.text}
      </span>
    ) : (
      <span key={i}>{c.text}</span>
    ),
  );
}
