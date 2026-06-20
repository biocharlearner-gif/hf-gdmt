import type { GdmtAssessment, PillarResult } from "../engine/types";
import type { GdmtAlert } from "../engine/alerts";

/**
 * Build FHIR R4 write-back payloads from the assessment. These are plain objects
 * you POST to your write-enabled FHIR server (HAPI / Cerner secure sandbox).
 *
 * Cross-server note: when reading from Epic but writing to HAPI, the Patient lives
 * on a different server. For a demo, use an absolute reference (full Epic URL) or
 * load the same synthetic patient into the write server. `patientRef` lets you pass
 * whichever reference form you need.
 */

export interface BuildOpts {
  patientRef: string;            // e.g. "Patient/abc" or absolute URL
  requesterRef?: string;         // e.g. "Practitioner/123"
  conditionRef?: string;         // HF Condition reference for reasonReference
}

const GAP_STATUSES = new Set(["GAP_ELIGIBLE", "ON_SUBTARGET"]);

export function buildTaskForGap(pillar: PillarResult, opts: BuildOpts): Record<string, unknown> {
  const verb = pillar.suggestedAction?.kind === "UPTITRATE" ? "Up-titrate" : "Initiate";
  return {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    priority: "routine",
    description: pillar.suggestedAction?.text ?? `${verb} ${pillar.label}`,
    code: { text: `GDMT: ${pillar.label}` },
    for: { reference: opts.patientRef },
    authoredOn: new Date().toISOString(),
    ...(opts.requesterRef ? { requester: { reference: opts.requesterRef } } : {}),
    ...(opts.conditionRef ? { focus: { reference: opts.conditionRef } } : {}),
    note: [{ text: `${pillar.reason} (Source: ${pillar.citationRef})` }],
  };
}

export function buildLabServiceRequest(opts: BuildOpts): Record<string, unknown> {
  return {
    resourceType: "ServiceRequest",
    status: "active",
    intent: "order",
    priority: "routine",
    code: {
      coding: [{ system: "http://loinc.org", code: "24323-8", display: "Basic metabolic panel" }],
      text: "BMP (potassium, eGFR) prior to GDMT titration",
    },
    subject: { reference: opts.patientRef },
    authoredOn: new Date().toISOString(),
    ...(opts.requesterRef ? { requester: { reference: opts.requesterRef } } : {}),
    ...(opts.conditionRef ? { reasonReference: [{ reference: opts.conditionRef }] } : {}),
  };
}

export function buildCarePlan(
  assessment: GdmtAssessment,
  taskRefs: string[],
  opts: BuildOpts,
): Record<string, unknown> {
  const gaps = assessment.pillars.filter((p) => GAP_STATUSES.has(p.status));
  const narrative =
    `GDMT optimization plan. Current GDMT score ${assessment.gdmtScore}/4. ` +
    `Targeting: ${gaps.map((g) => g.label).join("; ") || "none — at goal"}.`;
  return {
    resourceType: "CarePlan",
    status: "active",
    intent: "plan",
    title: "Heart Failure GDMT Optimization",
    description: narrative,
    subject: { reference: opts.patientRef },
    created: new Date().toISOString(),
    category: [{ text: "Heart failure GDMT" }],
    ...(opts.conditionRef ? { addresses: [{ reference: opts.conditionRef }] } : {}),
    activity: taskRefs.map((ref) => ({ reference: { reference: ref } })),
    text: {
      status: "generated",
      div: `<div xmlns="http://www.w3.org/1999/xhtml">${narrative}</div>`,
    },
  };
}

/** Convenience: every Task that should be created from an assessment. */
export function buildAllTasks(assessment: GdmtAssessment, opts: BuildOpts): Record<string, unknown>[] {
  return assessment.pillars
    .filter((p) => GAP_STATUSES.has(p.status))
    .map((p) => buildTaskForGap(p, opts));
}

/* ---------------------------------------------------------------------------
 * Remote-monitoring alert write-back. The engine only DETECTS and CITES; these
 * builders turn a fired GdmtAlert into FHIR artifacts a care team can see/act on.
 * Nothing here orders therapy — DetectedIssue/Flag record the finding, Task asks a
 * human to follow up. `triggeredBy` readings are echoed for provenance; pass
 * `observationRefs` when the source Observation ids are known to link evidence.
 * ------------------------------------------------------------------------- */

export interface AlertBuildOpts extends BuildOpts {
  observationRefs?: string[]; // references to the triggering Observation(s), if known
}

function alertEvidenceText(alert: GdmtAlert): string {
  return alert.triggeredBy
    .map((r) => `${r.value} @ ${r.date}`)
    .join("; ");
}

export function buildDetectedIssue(alert: GdmtAlert, opts: AlertBuildOpts): Record<string, unknown> {
  return {
    resourceType: "DetectedIssue",
    status: "final",
    severity: alert.severity, // high | moderate | low — maps 1:1 to FHIR
    code: { text: alert.title },
    patient: { reference: opts.patientRef },
    identifiedDateTime: new Date().toISOString(),
    detail: `${alert.detail} (Source: ${alert.citationRef}) [readings: ${alertEvidenceText(alert)}]`,
    ...(opts.observationRefs?.length
      ? { evidence: opts.observationRefs.map((ref) => ({ detail: [{ reference: ref }] })) }
      : {}),
  };
}

export function buildFlagForAlert(alert: GdmtAlert, opts: AlertBuildOpts): Record<string, unknown> {
  return {
    resourceType: "Flag",
    status: "active",
    category: [{ text: "Heart failure remote monitoring" }],
    code: { text: alert.title },
    subject: { reference: opts.patientRef },
    period: { start: new Date().toISOString() },
  };
}

export function buildTaskForAlert(alert: GdmtAlert, opts: AlertBuildOpts): Record<string, unknown> {
  const priority = alert.severity === "high" ? "urgent" : alert.severity === "moderate" ? "asap" : "routine";
  return {
    resourceType: "Task",
    status: "requested",
    intent: "order",
    priority,
    description: `Review HF alert: ${alert.title}`,
    code: { text: `HF remote-monitoring alert: ${alert.vital}` },
    for: { reference: opts.patientRef },
    authoredOn: new Date().toISOString(),
    ...(opts.requesterRef ? { requester: { reference: opts.requesterRef } } : {}),
    note: [{ text: `${alert.detail} (Source: ${alert.citationRef})` }],
  };
}

/**
 * Convenience: every artifact for one alert — DetectedIssue (the finding) + Flag
 * (chart banner) + Task (care-team follow-up). Caller POSTs each to the write server.
 */
export function buildAlertArtifacts(alert: GdmtAlert, opts: AlertBuildOpts): Record<string, unknown>[] {
  return [
    buildDetectedIssue(alert, opts),
    buildFlagForAlert(alert, opts),
    buildTaskForAlert(alert, opts),
  ];
}
