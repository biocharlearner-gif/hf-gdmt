/**
 * Source for /api/cds-services/[service] — CDS Hooks patient-view card (POST).
 * Bundled to api/cds-services/[service].js. Runs the SAME engine as the SPA and
 * returns a Card with the GDMT gap summary + a SMART-launch link back into the app.
 */
import { handlePatientView, SERVICE_ID, type CdsRequest } from "../src/cds/service";

const SMART_APP_URL = process.env.SMART_APP_URL || "http://localhost:5173";

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS },
  });
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

    const url = new URL(req.url);
    const service = url.pathname.split("/").pop();
    if (service !== SERVICE_ID) return json({ error: "unknown service" }, 404);

    const body = (await req.json().catch(() => ({}))) as CdsRequest;
    return json(handlePatientView(body, { smartAppUrl: SMART_APP_URL }));
  },
};
