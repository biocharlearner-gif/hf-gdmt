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
 * This module holds the PURE, transport-agnostic core (patientIdFromNotification,
 * processNotification) plus a factory for the network-backed FHIR deps. The HTTP
 * server that exposes `/notify` lives in server/index.ts (Bun.serve), so this file
 * stays free of any web-framework/runtime coupling and remains unit-testable.
 */
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

// ---- Network-backed FHIR deps (consumed by the Bun server, server/index.ts) --

export interface FhirDepsConfig {
  /** FHIR base URL to read Observations from. */
  readBase: string;
  /** FHIR base URL to write artifacts to (defaults to readBase). */
  writeBase?: string;
  /**
   * Bearer token for the tenant FHIR server (e.g. the Medblocks token). Held only
   * server-side and attached here — it must never reach the browser bundle.
   */
  token?: string;
}

/**
 * Build the real (network) `AlertServiceDeps` for a given FHIR base, optionally
 * authenticated. Kept here next to the pure core so all FHIR I/O for the alert loop
 * lives in one module; the Bun server wires this into the `/notify` route.
 */
export function createFhirDeps(config: FhirDepsConfig): AlertServiceDeps {
  const readBase = config.readBase.replace(/\/$/, "");
  const writeBase = (config.writeBase || config.readBase).replace(/\/$/, "");
  const authHeader = config.token ? { Authorization: `Bearer ${config.token}` } : {};
  return {
    readObservations: async (patientId) => {
      const res = await fetch(`${readBase}/Observation?patient=${patientId}&_count=200&_sort=-date`, {
        headers: { Accept: "application/fhir+json", ...authHeader },
      });
      if (!res.ok) throw new Error(`read Observations → ${res.status}`);
      return res.json();
    },
    createResource: async (resource) => {
      const res = await fetch(`${writeBase}/${resource.resourceType}`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json", Accept: "application/fhir+json", ...authHeader },
        body: JSON.stringify(resource),
      });
      if (!res.ok) throw new Error(`create ${resource.resourceType} → ${res.status}`);
      return res.json() as Promise<{ id?: string }>;
    },
  };
}
