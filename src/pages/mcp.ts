import type { APIRoute } from "astro";
import { handleMcp } from "../mcp/http.ts";

/** MCP over Streamable HTTP; authenticates by bearer token, not by the app's sign-in. */
export const ALL: APIRoute = (context) => {
  const forwarded = context.request.headers
    .get("x-forwarded-for")
    ?.split(",")[0]
    ?.trim();
  let address = "unknown";
  try {
    address = context.clientAddress;
  } catch {
    // Not available outside the node server (tests).
  }
  return handleMcp(context.request, forwarded || address);
};
