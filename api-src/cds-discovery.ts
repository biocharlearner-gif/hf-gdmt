/** Source for /api/cds-services — CDS Hooks discovery (GET). Bundled to api/cds-services.js. */
import { discovery } from "../src/cds/service";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    return new Response(JSON.stringify(discovery()), {
      status: 200,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  },
};
