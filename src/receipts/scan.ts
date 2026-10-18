import { env } from "cloudflare:workers";
import { roundCents } from "../domain/money.ts";
import type { Cents, LocalDate } from "../domain/types.ts";
import { localDate } from "../services/schemas.ts";
import { RECEIPT_PROMPT, RECEIPT_SCHEMA } from "./prompt.ts";

interface ScannedItem {
  name: string;
  quantity: number;
  unitCents: Cents;
}

export interface ScannedReceipt {
  merchant: string;
  /** `YYYY-MM-DD`, or "" when the receipt has none. */
  date: LocalDate | "";
  items: ScannedItem[];
  /** As printed; the items sum to it when the model followed the rules. */
  subtotalCents: Cents;
  taxCents: Cents;
  tipCents: Cents;
  discountCents: Cents;
  totalCents: Cents;
}

/** Scanning failed; the message is safe to show the user. */
export class ScanError extends Error {}

/** Workers AI vision model that reads receipts. */
export const SCAN_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

/** Scanning needs the Workers AI binding. */
export const scanConfigured = (): boolean => Boolean(env.AI);

const failed = (why: string) =>
  new ScanError(
    `Couldn't read the receipt (${why}). Try a clearer photo or enter the items by hand.`,
  );

/** Read a receipt image with a Workers AI vision model (JSON schema output). */
export async function scanReceipt(
  image: Uint8Array,
  mediaType: string,
): Promise<ScannedReceipt> {
  let out: { response?: unknown };
  try {
    out = (await env.AI.run(SCAN_MODEL, {
      messages: [
        { role: "system", content: RECEIPT_PROMPT },
        {
          role: "user",
          content: [
            {
              type: "image_url",
              image_url: {
                url: `data:${mediaType};base64,${Buffer.from(image).toString("base64")}`,
              },
            },
            { type: "text", text: "Read this receipt." },
          ],
        },
      ],
      response_format: { type: "json_schema", json_schema: RECEIPT_SCHEMA },
      max_tokens: 4096,
      temperature: 0,
    })) as { response?: unknown };
  } catch (err) {
    throw failed((err as Error).message.slice(0, 300));
  }
  return toReceipt(structuredOutput(out.response));
}

/** The model's JSON: an object already, or text holding one. */
function structuredOutput(response: unknown): unknown {
  if (response && typeof response === "object") return response;
  const text = typeof response === "string" ? response : "";
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  try {
    return JSON.parse(json);
  } catch {
    throw failed(text.trim().slice(0, 300) || "no answer");
  }
}

const cents = (dollars: unknown): Cents =>
  typeof dollars === "number" && Number.isFinite(dollars) && dollars > 0
    ? roundCents(dollars * 100)
    : 0;
const str = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Validate the model's dollars and convert them to cents. */
function toReceipt(raw: unknown): ScannedReceipt {
  if (
    !raw ||
    typeof raw !== "object" ||
    !Array.isArray((raw as { items?: unknown }).items)
  )
    throw new ScanError(
      "Couldn't read the receipt (unexpected answer). Try a clearer photo or enter the items by hand.",
    );
  const r = raw as Record<string, unknown> & { items: unknown[] };
  const items = r.items.map((it, i): ScannedItem => {
    const o = (it ?? {}) as Record<string, unknown>;
    const q = typeof o.quantity === "number" && o.quantity > 0 ? o.quantity : 1;
    const line = cents(o.totalPrice) || roundCents(q * cents(o.unitPrice));
    const unit = roundCents(line / q);
    // A weight times a rounded unit price can miss the line by a cent; keep the line exact.
    return roundCents(q * unit) === line
      ? { name: str(o.name) || `Item ${i + 1}`, quantity: q, unitCents: unit }
      : { name: str(o.name) || `Item ${i + 1}`, quantity: 1, unitCents: line };
  });
  const subtotalCents =
    cents(r.subtotal) ||
    items.reduce((s, it) => s + roundCents(it.quantity * it.unitCents), 0);
  const taxCents = cents(r.tax);
  const tipCents = cents(r.tip);
  const discountCents = cents(r.discount);
  return {
    merchant: str(r.merchant),
    date: localDate.safeParse(r.date).success ? (r.date as string) : "",
    items,
    subtotalCents,
    taxCents,
    tipCents,
    discountCents,
    totalCents:
      cents(r.total) || subtotalCents + taxCents + tipCents - discountCents,
  };
}
