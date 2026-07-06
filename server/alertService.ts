/**
 * Remote-monitoring alert service — the endpoint a FHIR Subscription notifies when a
 * vital-signs Observation is created. It completes the loop the SPA can only do on
 * page load:
 *
 *   device → Observation stored → Subscription fires → THIS service →
 *   re-read recent Observations → pure engine (evaluateAlerts) → write DetectedIssue + Flag + Task
 *
 * The SAME pure engine + writeback builders the SPA uses run here (logic lives once).
 * The engine only detects & cites; the Task it writes is a care-team review item, not
 * an order — so automated writeback stays within the "never auto-prescribe" rule.
 *
 * Run:  npm run alert-service                 (defaults to hapi.fhir.org/baseR4)
 *       FHIR_READ_BASE=… FHIR_WRITE_BASE=… PORT=8787 npm run alert-service
 */
import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { buildAlertInput } from "../src/fhir/extract";
import { evaluateAlerts, type GdmtAlert } from "../src/engine/alerts";
import { buildDetectedIssue, buildFlagForAlert, buildTaskForAlert } from "../src/fhir/writeback";

type Json = Record<string, unknown>;

/** Injectable I/O so the core is unit-testable without a network. */
export interface AlertServiceDeps {
  /** Fetch the patient's Observations (Bundle or array) for the engine. */
  readObservations: (patientId: string) => Promise<unknown>;
  /** Persist a built artifact; returns its id. */
  createResource: (resource: Json) => Promise<{ id?: string }>;
  /** Injected clock for deterministic recency in the engine. */
  now?: () => string;
}

export interface NotificationResult {
  patientId: string | null;
  alerts: GdmtAlert[];
  created: { detectedIssueId?: string; flagId?: string; taskId?: string }[];
}

/**
 * Extract the affected patient id from a Subscription notification body. Handles a raw
 * Observation, a notification Bundle, and an explicit `{ patientId }` ping.
 */
export function patientIdFromNotification(body: unknown): string | null {
  const b = body as Json | null;
  if (!b || typeof b !== "object") return null;

  if (typeof b.patientId === "string") return b.patientId;

  const subjectRef = (r: Json | undefined): string | null => {
    const ref = (r?.subject as Json | undefined)?.reference;
    return typeof ref === "string" && ref.startsWith("Patient/") ? ref.slice("Patient/".length) : null;
  };

  if (b.resourceType === "Observation") return subjectRef(b);

  if (b.resourceType === "Bundle") {
    const entries = (b.entry as { resource?: Json }[] | undefined) ?? [];
    for (const e of entries) {
      if (e.resource?.resourceType === "Observation") {
        const id = subjectRef(e.resource);
        if (id) return id;
      }
    }
  }
  return null;
}

/**
 * Core handler: given a notification body, evaluate the patient's vitals and write
 * back artifacts for every alert. Pure of transport; deps do the I/O.
 */
export async function processNotification(body: unknown, deps: AlertServiceDeps): Promise<NotificationResult> {
  const patientId = patientIdFromNotification(body);
  if (!patientId) return { patientId: null, alerts: [], created: [] };

  const observations = await deps.readObservations(patientId);
  const input = buildAlertInput({ patientId, observations: observations as never, now: deps.now?.() });
  const alerts = evaluateAlerts(input);

  const opts = { patientRef: `Patient/${patientId}` };
  const created: NotificationResult["created"] = [];
  for (const alert of alerts) {
    const [di, flag, task] = await Promise.all([
      deps.createResource(buildDetectedIssue(alert, opts)),
      deps.createResource(buildFlagForAlert(alert, opts)),
      deps.createResource(buildTaskForAlert(alert, opts)),
    ]);
    created.push({ detectedIssueId: di.id, flagId: flag.id, taskId: task.id });
  }
  return { patientId, alerts, created };
}

// ---- HTTP server (only runs when executed directly) -------------------------

const READ_BASE = (process.env.FHIR_READ_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
const WRITE_BASE = (process.env.FHIR_WRITE_BASE || READ_BASE).replace(/\/$/, "");
const PORT = Number(process.env.PORT || 8787);

const httpDeps: AlertServiceDeps = {
  readObservations: async (patientId) => {
    const res = await fetch(`${READ_BASE}/Observation?patient=${patientId}&_count=200&_sort=-date`, {
      headers: { Accept: "application/fhir+json" },
    });
    if (!res.ok) throw new Error(`read Observations → ${res.status}`);
    return res.json();
  },
  createResource: async (resource) => {
    const res = await fetch(`${WRITE_BASE}/${resource.resourceType}`, {
      method: "POST",
      headers: { "Content-Type": "application/fhir+json", Accept: "application/fhir+json" },
      body: JSON.stringify(resource),
    });
    if (!res.ok) throw new Error(`create ${resource.resourceType} → ${res.status}`);
    return res.json() as Promise<{ id?: string }>;
  },
};

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch {
        resolve({});
      }
    });
  });
}

function startServer() {
  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
    if (req.method === "GET" && url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, readBase: READ_BASE, writeBase: WRITE_BASE }));
      return;
    }
    if (req.method === "POST" && url.pathname === "/notify") {
      try {
        let body = await readBody(req);
        // Allow ?patient=<id> as a fallback when the server sends an empty ping.
        const pidParam = url.searchParams.get("patient");
        if (pidParam && (!body || typeof body !== "object" || !Object.keys(body as object).length)) {
          body = { patientId: pidParam };
        }
        const result = await processNotification(body, httpDeps);
        console.log(`[notify] patient=${result.patientId} alerts=${result.alerts.length} written=${result.created.length}`);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      } catch (e) {
        console.error("[notify] error", e);
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: e instanceof Error ? e.message : "error" }));
      }
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });
  server.listen(PORT, () => {
    console.log(`HF alert service on http://localhost:${PORT}`);
    console.log(`  read=${READ_BASE} write=${WRITE_BASE}`);
    console.log(`  POST /notify  (Subscription rest-hook target)  ·  GET /health`);
  });
}

// Run the server only when this file is the entry point (not when imported by tests).
const invokedDirectly = Boolean(process.argv[1]) && resolve(fileURLToPath(import.meta.url)) === resolve(process.argv[1]!);
if (invokedDirectly) startServer();
