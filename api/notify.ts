/**
 * Vercel serverless function: FHIR Subscription rest-hook target (the alert loop).
 *
 * A vital-signs Observation is created on the tenant server → the Subscription
 * notifies THIS endpoint → re-read the patient's Observations → pure evaluateAlerts →
 * write DetectedIssue + Flag + Task. Same pure core the Bun BFF (/notify) uses.
 *
 * Register the Subscription against `https://<app>.vercel.app/notify`
 * (rewritten to /api/notify by vercel.json).
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

async function handle(req: Request): Promise<Response> {
  if (req.method !== "POST") return json({ error: "method not allowed" }, 405);

  try {
    const url = new URL(req.url);
    let body: unknown = await req.json().catch(() => ({}));
    // Allow ?patient=<id> as a fallback when the server sends an empty ping.
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
}

export default { fetch: handle };
