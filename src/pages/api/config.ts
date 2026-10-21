import { route } from "../../api/http.ts";
import { VERSION } from "../../config.ts";
import { scanConfigured } from "../../receipts/scan.ts";

/** `version` is the deployed release; an open page compares it with its own to offer an update. */
export const GET = route(() => ({ scan: scanConfigured(), version: VERSION }));
