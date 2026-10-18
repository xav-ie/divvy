import { z } from "zod";
import { NAME_MAX } from "../domain/limits.ts";
import { AMOUNT_MODES, SPLIT_TYPES } from "../domain/types.ts";

export { NAME_MAX };

/** Input schemas shared by services, the HTTP API and MCP. Services parse their own input. */

const text = (max: number) => z.string().trim().max(max);
/** User, member and group names; the database enforces the same 1..NAME_MAX. */
const name = z
  .string()
  .trim()
  .min(1, "Name can't be empty")
  .max(NAME_MAX, `Names can be at most ${NAME_MAX} characters`);
const email = z
  .string()
  .trim()
  .toLowerCase()
  .pipe(z.email("That doesn't look like an email address"));
const cents = z
  .number()
  .int("Amounts must be whole cents")
  .min(0, "Amounts can't be negative");
const memberKey = z.string().regex(/^\d+$/, "Keys must be member ids");

/** A real calendar date as `YYYY-MM-DD`. */
export const localDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Dates must look like 2026-01-31")
  .refine((s) => {
    const [y, m, d] = s.split("-").map(Number) as [number, number, number];
    const date = new Date(Date.UTC(y, m - 1, d));
    return (
      date.getUTCFullYear() === y &&
      date.getUTCMonth() === m - 1 &&
      date.getUTCDate() === d
    );
  }, "That date doesn't exist");

export const id = z.coerce.number().int().positive();

/** A Venmo username: an optional leading @ is dropped; null or "" clears it. */
const venmo = z
  .string()
  .trim()
  .transform((v) => v.replace(/^@/, ""))
  .pipe(
    z
      .string()
      .regex(
        /^$|^[A-Za-z0-9_-]{5,30}$/,
        "Venmo usernames are 5 to 30 letters, digits, hyphens or underscores",
      ),
  )
  .transform((v) => v || null)
  .nullable();

export const ProfileInput = z
  .object({
    name: name.optional(),
    venmo: venmo.optional(),
    /** From POST /api/me/venmo/preview; required to save a (new) username. */
    previewId: z.string().optional(),
  })
  .refine(
    (p) => p.name !== undefined || p.venmo !== undefined,
    "Nothing to change",
  );
/** "I'm new here" on the picker: the email maps them to invites and, later, Access. */
export const NewPersonInput = z.object({ name, email });

export const GroupInput = z.object({ name, emoji: text(16).default("") });
export const GroupPatch = z.object({
  name: name.optional(),
  emoji: text(16).optional(),
  simplify: z.boolean().optional(),
});

/** A placeholder by name, an invite by email, or both. */
export const MemberInput = z
  .object({ name: name.optional(), email: email.optional() })
  .refine((m) => m.name || m.email, "Give a name or an email");
export const InviteEmailInput = z.object({ email });
/** Rename and/or invite a placeholder. */
export const MemberPatch = z
  .object({ name: name.optional(), email: email.optional() })
  .refine((m) => m.name || m.email, "Give a name or an email");

const ItemInput = z.object({
  name: text(200).default(""),
  quantity: z.number().positive("Quantity must be above 0").default(1),
  unitCents: cents,
  splitType: z.enum(SPLIT_TYPES),
  /** member id -> weight, percent or cents depending on splitType. */
  split: z.record(memberKey, z.number().min(0)),
});

export const ExpenseInput = z.object({
  title: text(200).min(1, "Give the expense a title"),
  date: localDate,
  items: z.array(ItemInput).min(1, "Add at least one item").max(500),
  /**
   * Tax, tip and discount: `*Mode` "amount" (`*Value` in cents) or "percent"
   * (`*Value` percent of the item subtotal). `*Cents` alone still works as an amount.
   */
  taxCents: cents.default(0),
  tipCents: cents.default(0),
  discountCents: cents.default(0),
  taxMode: z.enum(AMOUNT_MODES).default("amount"),
  taxValue: z.number().min(0).optional(),
  tipMode: z.enum(AMOUNT_MODES).default("amount"),
  tipValue: z.number().min(0).optional(),
  discountMode: z.enum(AMOUNT_MODES).default("amount"),
  discountValue: z.number().min(0).optional(),
  /** member id -> cents paid; must sum to the total. */
  payers: z.record(memberKey, cents),
  category: text(50).nullable().default(null),
  notes: text(5000).default(""),
  /** Set by receipt scanning; the HTTP API strips it. Omit on update to keep the current value. */
  receiptPath: z.string().nullable().optional(),
  /** Who takes leftover rounding cents (recurring: the template's creator); the HTTP API strips it. */
  oddCentsTo: z.number().int().positive().optional(),
  /** Set by recurring billing; the HTTP API strips it. Omit on update to keep the current value. */
  recurringId: z.number().int().positive().nullable().optional(),
});

export const PaymentInput = z.object({
  fromMember: id,
  toMember: id,
  cents: cents.positive("The amount must be more than $0.00"),
  date: localDate,
  note: text(500).default(""),
});

/** A personal access token's label, e.g. "Claude on my laptop". */
export const TokenInput = z.object({ name });

export type ProfileInput = z.input<typeof ProfileInput>;
export type TokenInput = z.input<typeof TokenInput>;
export type NewPersonInput = z.input<typeof NewPersonInput>;
export type GroupInput = z.input<typeof GroupInput>;
export type GroupPatch = z.input<typeof GroupPatch>;
export type MemberInput = z.input<typeof MemberInput>;
export type MemberPatch = z.input<typeof MemberPatch>;
export type ExpenseInput = z.input<typeof ExpenseInput>;
export type PaymentInput = z.input<typeof PaymentInput>;
