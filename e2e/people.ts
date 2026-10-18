import { closeSync, mkdirSync, openSync } from "node:fs";
import { join } from "node:path";

/** Roommates each test can act as; every test gets its own copy (a slot) so balances never mix. */
const NAMES = ["Ana", "Ben", "Cy", "Dee"] as const;
export type Name = (typeof NAMES)[number];

const SLOTS = 300;

export const emailFor = (name: Name, slot: number) =>
  `${name.toLowerCase()}.${slot}@e2e.test`;

/** Every email the dev server accepts in the x-divvy-dev-user header. */
export const devUserEmails = (): string[] =>
  Array.from({ length: SLOTS }, (_, slot) =>
    NAMES.map((n) => emailFor(n, slot)),
  ).flat();

/** A slot no other test in this run has used (exclusive file create across workers). */
export function claimSlot(): number {
  const dir = join(process.env.DIVVY_E2E_DIR!, "slots");
  mkdirSync(dir, { recursive: true });
  for (let slot = 0; slot < SLOTS; slot++) {
    try {
      closeSync(openSync(join(dir, String(slot)), "wx"));
      return slot;
    } catch {
      // taken
    }
  }
  throw new Error("e2e: out of user slots; raise SLOTS in e2e/people.ts");
}
