import type { GdmtAssessment, PillarResult, PillarStatus } from "../engine/types";
import type { GdmtAlert } from "../engine/alerts";
import { isApplicablePillar } from "../engine/engine";

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
  authorDisplay?: string;        // CarePlan.author.display (kept out of the pure builder's imports)
}

/** Map an engine pillar status to a FHIR R4 CarePlanActivityStatus. Pure, exported for tests. */
export function pillarActivityStatus(status: PillarStatus): string {
  switch (status) {
    case "ON_TARGET": return "completed";
    case "ON_SUBTARGET": return "in-progress";
    case "GAP_ELIGIBLE":
    case "GAP_LABS_NEEDED": return "not-started";
    case "CONTRAINDICATED": return "on-hold";
    default: return "unknown"; // INSUFFICIENT_DATA
  }
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
  const now = new Date().toISOString();
  const applicable = assessment.pillars.filter((p) => isApplicablePillar(assessment.phenotype, p.id));
  const gaps = applicable.filter((p) => GAP_STATUSES.has(p.status));
  const eligibleGaps = applicable.filter((p) => p.status === "GAP_ELIGIBLE").length;
  const narrative =
    `GDMT optimization plan. Current GDMT score ${assessment.gdmtScore}/4. ` +
    `Targeting: ${gaps.map((g) => g.label).join("; ") || "none — at goal"}.`;

  // Contained Goals travel with the plan (single create/read), still valid R4.
  const goals: Record<string, unknown>[] = [
    {
      resourceType: "Goal",
      id: "goal-target",
      lifecycleStatus: "active",
      description: { text: "Achieve target-dose GDMT across all eligible pillars" },
      subject: { reference: opts.patientRef },
    },
  ];
  if (eligibleGaps > 0) {
    goals.push({
      resourceType: "Goal",
      id: "goal-gaps",
      lifecycleStatus: "active",
      description: { text: `Close ${eligibleGaps} eligible GDMT gap(s) now` },
      subject: { reference: opts.patientRef },
    });
  }

  // One activity per applicable pillar (detail), plus the accepted-gap Task references.
  const pillarActivities = applicable.map((p) => ({
    detail: {
      kind: p.status === "GAP_LABS_NEEDED" ? "ServiceRequest" : "MedicationRequest",
      code: { text: p.label },
      status: pillarActivityStatus(p.status),
      description: p.reason,
    },
  }));
  const taskActivities = taskRefs.map((ref) => ({ reference: { reference: ref } }));

  return {
    resourceType: "CarePlan",
    status: "active",
    intent: "plan",
    title: "Heart Failure GDMT Optimization",
    description: narrative,
    subject: { reference: opts.patientRef },
    created: now,
    period: { start: now },
    category: [{ text: "Heart failure GDMT" }],
    ...(opts.authorDisplay ? { author: { display: opts.authorDisplay } } : {}),
    ...(opts.conditionRef ? { addresses: [{ reference: opts.conditionRef }] } : {}),
    contained: goals,
    goal: goals.map((g) => ({ reference: `#${g.id as string}` })),
    activity: [...pillarActivities, ...taskActivities],
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
  /** The single Observation that triggered the alert (Task.focus / provenance). */
  focusObservationRef?: string;
  /** Initial Task.status — UI accept sets "accepted"; automated path leaves "requested". */
  taskStatus?: string;
  /** Care provider the Task is assigned to (Task.owner.display), e.g. the accepting clinician. */
  ownerDisplay?: string;
}

/** Identifier system for alert-derived artifacts — enables idempotent conditional create. */
export const ALERT_IDENTIFIER_SYSTEM = "urn:hf-gdmt:alert";

/**
 * Stable key identifying one alert occurrence: patient + rule + the triggering reading's
 * date. Re-accepting the SAME alert yields the SAME key, so a conditional create
 * (If-None-Exist) won't produce duplicate Tasks/DetectedIssues/Flags.
 */
export function alertKey(patientRef: string, alert: GdmtAlert): string {
  const patientId = patientRef.replace(/^Patient\//, "");
  const last = alert.triggeredBy[alert.triggeredBy.length - 1];
  return `${patientId}:${alert.id}:${last?.date ?? ""}`;
}

function alertEvidenceText(alert: GdmtAlert): string {
  return alert.triggeredBy
    .map((r) => `${r.value} @ ${r.date}`)
    .join("; ");
}

function alertIdentifier(patientRef: string, alert: GdmtAlert, suffix: string) {
  return [{ system: ALERT_IDENTIFIER_SYSTEM, value: `${alertKey(patientRef, alert)}:${suffix}` }];
}

export function buildDetectedIssue(alert: GdmtAlert, opts: AlertBuildOpts): Record<string, unknown> {
  const observationRefs = opts.observationRefs ?? (opts.focusObservationRef ? [opts.focusObservationRef] : []);
  return {
    resourceType: "DetectedIssue",
    identifier: alertIdentifier(opts.patientRef, alert, "issue"),
    status: "final",
    severity: alert.severity, // high | moderate | low — maps 1:1 to FHIR
    code: { text: alert.title },
    patient: { reference: opts.patientRef },
    identifiedDateTime: new Date().toISOString(),
    detail: `${alert.detail} (Source: ${alert.citationRef}) [readings: ${alertEvidenceText(alert)}]`,
    ...(observationRefs.length
      ? { evidence: observationRefs.map((ref) => ({ detail: [{ reference: ref }] })) }
      : {}),
  };
}

export function buildFlagForAlert(alert: GdmtAlert, opts: AlertBuildOpts): Record<string, unknown> {
  return {
    resourceType: "Flag",
    identifier: alertIdentifier(opts.patientRef, alert, "flag"),
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
    identifier: alertIdentifier(opts.patientRef, alert, "task"),
    status: opts.taskStatus ?? "requested",
    intent: "order",
    priority,
    description: `Review HF alert: ${alert.title}`,
    code: { text: `HF remote-monitoring alert: ${alert.vital}` },
    for: { reference: opts.patientRef },
    authoredOn: new Date().toISOString(),
    // Link the Task to the Observation that triggered the alert (provenance/mapping).
    ...(opts.focusObservationRef ? { focus: { reference: opts.focusObservationRef } } : {}),
    ...(opts.requesterRef ? { requester: { reference: opts.requesterRef } } : {}),
    ...(opts.ownerDisplay ? { owner: { display: opts.ownerDisplay } } : {}),
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
