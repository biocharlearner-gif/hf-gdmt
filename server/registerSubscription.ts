/**
 * Register the vital-signs Subscription on the FHIR server, pointing it at our alert
 * service's /notify endpoint. Run after the alert service is reachable at a PUBLIC URL
 * (the FHIR server must be able to POST to it — localhost won't work for a hosted
 * server like hapi.fhir.org; use a tunnel such as ngrok, or a deployed URL).
 *
 * Run:  CALLBACK_URL=https://<public-host>/notify bun server/registerSubscription.ts
 *       FHIR_BASE=<url> CALLBACK_URL=… bun server/registerSubscription.ts
 *
 * Targets the tenant FHIR server (MEDBLOCKS_FHIR_BASE) with its Bearer token by
 * default; both are read from the environment (.env.local), never hardcoded.
 */
import { buildVitalsSubscription } from "../src/fhir/subscription";

const FHIR_BASE = (
  process.env.FHIR_BASE || process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4"
).replace(/\/$/, "");
const FHIR_TOKEN = process.env.FHIR_TOKEN || process.env.MEDBLOCKS_TOKEN;
const CALLBACK_URL = process.env.CALLBACK_URL;

async function main() {
  if (!CALLBACK_URL) {
    console.error("Set CALLBACK_URL to the public URL of the alert service, e.g.");
    console.error("  CALLBACK_URL=https://abcd-1234.ngrok-free.app/notify npm run register-subscription");
    process.exit(1);
  }
  const sub = buildVitalsSubscription({ endpoint: CALLBACK_URL });
  console.log(`Registering Subscription on ${FHIR_BASE} → ${CALLBACK_URL}`);
  console.log(`  criteria: ${sub.criteria}`);

  const res = await fetch(`${FHIR_BASE}/Subscription`, {
    method: "POST",
    headers: {
      "Content-Type": "application/fhir+json",
      Accept: "application/fhir+json",
      ...(FHIR_TOKEN ? { Authorization: `Bearer ${FHIR_TOKEN}` } : {}),
    },
    body: JSON.stringify(sub),
  });
  if (!res.ok) {
    console.error(`Failed: ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }
  const created = (await res.json()) as { id?: string; status?: string };
  console.log(`Created Subscription/${created.id} (status: ${created.status}).`);
  console.log("The server will now POST vital-signs Observations to the alert service.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
