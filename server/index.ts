/**
 * HF-GDMT backend-for-frontend (BFF) — Bun runtime.
 *
 * A single Bun.serve process that owns the tenant FHIR credentials and exposes three
 * concerns, reusing the app's pure, transport-agnostic code (logic lives once):
 *
 *   /api/fhir/*                     authenticated reverse proxy → tenant FHIR server.
 *                                   The SPA talks to THIS; the Bearer token never
 *                                   reaches the browser bundle.
 *   GET  /cds-services              CDS Hooks discovery              (src/cds/service.ts)
 *   POST /cds-services/<id>         CDS Hooks patient-view card      (src/cds/service.ts)
 *   POST /notify                    FHIR Subscription rest-hook target (alert loop)
 *   GET  /health                    liveness + config echo (no secret leaked)
 *
 * Config (all server-side, NEVER VITE_-prefixed so Vite can't inline into the client):
 *   MEDBLOCKS_FHIR_BASE   tenant FHIR base URL   (default: public HAPI, unauthenticated)
 *   MEDBLOCKS_TOKEN       tenant Bearer token    (kept in git-ignored .env.local)
 *   SMART_APP_URL         where the SPA is hosted, for CDS launch links
 *   PORT                  listen port            (default 8787)
 *
 * Run:  bun server/index.ts        (Bun auto-loads .env / .env.local)
 */
import { discovery, handlePatientView, SERVICE_ID, type CdsRequest } from "../src/cds/service";
import { createFhirDeps, processNotification } from "./alertService";
import { proxyFhir } from "./fhirProxy";

const MEDBLOCKS_FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
const MEDBLOCKS_TOKEN = process.env.MEDBLOCKS_TOKEN || undefined;
const SMART_APP_URL = process.env.SMART_APP_URL || "http://localhost:5173";
const PORT = Number(process.env.PORT || 8787);

/** Alert-loop I/O, authenticated against the tenant server. */
const fhirDeps = createFhirDeps({ readBase: MEDBLOCKS_FHIR_BASE, token: MEDBLOCKS_TOKEN });

/** CDS Hooks is called cross-origin by EHR sandboxes, so it needs CORS. */
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function json(data: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url);
    const { pathname } = url;

    try {
      if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

      if (req.method === "GET" && pathname === "/health") {
        return json({ ok: true, fhirBase: MEDBLOCKS_FHIR_BASE, authenticated: Boolean(MEDBLOCKS_TOKEN) });
      }

      // ---- CDS Hooks -------------------------------------------------------
      if (req.method === "GET" && pathname === "/cds-services") {
        return json(discovery(), 200, CORS);
      }
      if (req.method === "POST" && pathname === `/cds-services/${SERVICE_ID}`) {
        const body = (await req.json().catch(() => ({}))) as CdsRequest;
        return json(handlePatientView(body, { smartAppUrl: SMART_APP_URL }), 200, CORS);
      }

      // ---- Subscription rest-hook target -----------------------------------
      if (req.method === "POST" && pathname === "/notify") {
        let body: unknown = await req.json().catch(() => ({}));
        // Allow ?patient=<id> as a fallback when the server sends an empty ping.
        const pid = url.searchParams.get("patient");
        if (pid && (!body || typeof body !== "object" || !Object.keys(body as object).length)) {
          body = { patientId: pid };
        }
        const result = await processNotification(body, fhirDeps);
        console.log(`[notify] patient=${result.patientId} alerts=${result.alerts.length} written=${result.created.length}`);
        return json(result);
      }

      // ---- Authenticated FHIR proxy for the SPA ----------------------------
      if (pathname === "/api/fhir" || pathname.startsWith("/api/fhir/")) {
        return proxyFhir(req, url, { fhirBase: MEDBLOCKS_FHIR_BASE, token: MEDBLOCKS_TOKEN });
      }

      return json({ error: "not found" }, 404);
    } catch (e) {
      console.error(`[${req.method} ${pathname}] error`, e);
      return json({ error: e instanceof Error ? e.message : "error" }, 500);
    }
  },
});

console.log(`HF-GDMT BFF on http://localhost:${PORT}`);
console.log(`  FHIR proxy  /api/fhir/*  → ${MEDBLOCKS_FHIR_BASE}  (authenticated: ${Boolean(MEDBLOCKS_TOKEN)})`);
console.log(`  CDS Hooks   GET /cds-services · POST /cds-services/${SERVICE_ID}`);
console.log(`  Alert loop  POST /notify  ·  GET /health`);
