import { env } from "cloudflare:workers";

/** Just enough of a PNG for sniffing. */
export const PNG: Uint8Array<ArrayBuffer> = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3,
]);

/** A successful scan of a two-line receipt, in dollars as the model returns it. */
export const RECEIPT = {
  merchant: "Corner Shop",
  date: "2026-03-04",
  items: [
    { name: "Bread", quantity: 1, unitPrice: 3.5, totalPrice: 3.5 },
    { name: "Eggs", quantity: 2, unitPrice: 2.25, totalPrice: 4.5 },
  ],
  subtotal: 8,
  tax: 0.64,
  tip: 0,
  discount: 0,
  total: 8.64,
};

interface AiCall {
  model: string;
  inputs: any;
}

/**
 * Replace the Workers AI binding with one answering `response` (an Error
 * rejects instead; undefined removes the binding). Returns the calls it gets.
 */
export function fakeAi(response?: unknown): AiCall[] {
  const calls: AiCall[] = [];
  const vars = env as unknown as Record<string, unknown>;
  if (response === undefined) {
    delete vars.AI;
    return calls;
  }
  vars.AI = {
    run: async (model: string, inputs: unknown) => {
      calls.push({ model, inputs });
      if (response instanceof Error) throw response;
      return { response };
    },
  };
  return calls;
}
