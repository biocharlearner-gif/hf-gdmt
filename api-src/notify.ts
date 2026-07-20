/**
 * Source for /api/notify — FHIR Subscription rest-hook target (the alert loop).
 * Bundled to api/notify.js. Re-reads the patient's Observations → pure evaluateAlerts
 * → write DetectedIssue + Flag + Task (idempotent). Same pure core the Bun BFF uses.
 */
import { createFhirDeps, processNotification } from "../server/alertService";

const FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
const TOKEN = process.env.MEDBLOCKS_TOKEN || undefined;

const fhirDeps = createFhirDeps({ readBase: FHIR_BASE, token: TOKEN });

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    try {
      const url = new URL(req.url);
      let body: unknown = await req.json().catch(() => ({}));
      const pid = url.searchParams.get("patient");
      if (pid && (!body || typeof body !== "object" || !Object.keys(body as object).length)) {
        body = { patientId: pid };
      }
      const result = await processNotification(body, fhirDeps);
      console.log(`[notify] patient=${result.patientId} alerts=${result.alerts.length} written=${result.created.length}`);
      return json(result);
    } catch (e) {
      console.error("[notify] error", e);
      return json({ error: e instanceof Error ? e.message : "error" }, 500);
    }
  },
};
