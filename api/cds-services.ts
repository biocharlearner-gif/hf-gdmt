/**
 * Vercel serverless function: CDS Hooks discovery.
 * GET /cds-services (rewritten to /api/cds-services by vercel.json).
 *
 * Called cross-origin by EHR sandboxes, so CORS is emitted here.
 */
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
