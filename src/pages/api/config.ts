import { route } from "../../api/http.ts";
import { scanConfigured } from "../../receipts/scan.ts";

export const GET = route(() => ({ scan: scanConfigured() }));
