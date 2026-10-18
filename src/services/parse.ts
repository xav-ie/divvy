import type { z } from "zod";
import { invalid } from "./errors.ts";

/** Validate `value`; the first problem becomes a 400 with a readable message. */
export function parse<S extends z.ZodType>(
  schema: S,
  value: unknown,
): z.output<S> {
  const r = schema.safeParse(value);
  if (r.success) return r.data;
  const issue = r.error.issues[0]!;
  const path = issue.path.join(".");
  throw invalid(
    path && issue.code !== "custom"
      ? `${path}: ${issue.message}`
      : issue.message,
  );
}
