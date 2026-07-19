import type { FhirResource } from "./patientApi";
import { classifyMed } from "../engine/codes";
import type { PillarId } from "../engine/types";

/**
 * Presentation-layer summarizers for Condition (problem list) and MedicationRequest
 * resources. These produce plain display shapes for the profile cards; they are
 * separate from `src/fhir/extract.ts` (which builds the pure EngineInput) so the UI
 * can show human-friendly labels/status without coupling to the engine model.
 */

interface Coding { system?: string; code?: string; display?: string }
interface CodeableConcept { coding?: Coding[]; text?: string }

function conceptText(cc?: CodeableConcept): string {
  return cc?.text ?? cc?.coding?.[0]?.display ?? cc?.coding?.[0]?.code ?? "—";
}

/** First code of a status CodeableConcept (e.g. clinicalStatus → "active"). */
function statusCode(cc?: CodeableConcept): string | undefined {
  return cc?.coding?.[0]?.code ?? cc?.text;
}

/**
 * Which side of the Active / Resolved toggle a row belongs on. Deliberately coarser
 * than the FHIR status codes — the codes are still shown verbatim on each row's chip,
 * this only drives the filter.
 */
export type Activity = "active" | "resolved";

/**
 * Condition.clinicalStatus → toggle side. `recurrence`/`relapse` are active problems
 * (the patient has it again); `remission`/`inactive` sit with `resolved` as "not a
 * current problem".
 *
 * An unrecognised or absent status counts as **active**: a filter that silently hides
 * a problem because its status was missing is worse than showing it (see CLAUDE.md —
 * degrade gracefully, never drop data).
 */
export function conditionActivity(clinicalStatus?: string): Activity {
  switch (clinicalStatus?.toLowerCase()) {
    case "inactive":
    case "remission":
    case "resolved":
      return "resolved";
    default:
      return "active";
  }
}

/**
 * MedicationRequest.status → toggle side. Same graceful-degradation rule as
 * `conditionActivity`: unknown/missing → active.
 *
 * NOTE: this is intentionally NOT the same predicate as `isOnTherapy` in `fhir/extract.ts`,
 * and the two must not be merged — the divergence is a safety property, not a bug to fix.
 * This one drives a display filter, so an unrecognised status falls back to *active*: never
 * silently hide a row from the clinician. That one drives GDMT gap scoring, so an
 * unrecognised status must fall back to *not* on therapy: a false "on therapy" silently
 * closes a real gap. Same question, opposite safe default. `draft` and `unknown` land on
 * different sides for exactly this reason.
 */
export function medicationActivity(status?: string): Activity {
  switch (status?.toLowerCase()) {
    case "stopped":
    case "completed":
    case "cancelled":
    case "ended":
    case "entered-in-error":
      return "resolved";
    default:
      return "active";
  }
}

export interface ProblemSummary {
  id: string;
  display: string;
  /** SNOMED / ICD-10 code shown for provenance. */
  code?: string;
  system?: string;
  clinicalStatus?: string;
  verificationStatus?: string;
  category?: string;
  onset?: string;
  /** Which side of the Active / Resolved toggle this problem belongs on. */
  activity: Activity;
}

export function summarizeCondition(r: FhirResource): ProblemSummary {
  const c = r as FhirResource & {
    id?: string;
    code?: CodeableConcept;
    clinicalStatus?: CodeableConcept;
    verificationStatus?: CodeableConcept;
    category?: CodeableConcept[];
    onsetDateTime?: string;
    recordedDate?: string;
  };
  const coding = c.code?.coding?.[0];
  const clinicalStatus = statusCode(c.clinicalStatus);
  return {
    id: c.id ?? Math.random().toString(36).slice(2),
    display: conceptText(c.code),
    code: coding?.code,
    system: coding?.system,
    clinicalStatus,
    verificationStatus: statusCode(c.verificationStatus),
    category: c.category?.[0] ? conceptText(c.category[0]) : undefined,
    onset: c.onsetDateTime ?? c.recordedDate,
    activity: conditionActivity(clinicalStatus),
  };
}

export interface MedicationSummary {
  id: string;
  name: string;
  /** Dosage instruction text, e.g. "25 mg once daily". */
  dose?: string;
  status?: string;
  /** Why the med was stopped, when the prescriber recorded it. */
  statusReason?: string;
  /** GDMT pillar this med maps to (via engine value sets), if any. */
  pillar: PillarId | null;
  /** Which side of the Active / Resolved toggle this med belongs on. */
  activity: Activity;
}

export function summarizeMedication(r: FhirResource): MedicationSummary {
  const m = r as FhirResource & {
    id?: string;
    status?: string;
    statusReason?: CodeableConcept;
    medicationCodeableConcept?: CodeableConcept;
    dosageInstruction?: Array<{ text?: string }>;
  };
  const name = conceptText(m.medicationCodeableConcept);
  return {
    id: m.id ?? Math.random().toString(36).slice(2),
    name,
    dose: m.dosageInstruction?.[0]?.text,
    status: m.status,
    statusReason: m.statusReason ? conceptText(m.statusReason) : undefined,
    pillar: classifyMed(name),
    activity: medicationActivity(m.status),
  };
}

/** Human label for a GDMT pillar (short form used on med chips). */
export const PILLAR_SHORT: Record<PillarId, string> = {
  RAASi: "RAASi",
  BetaBlocker: "Beta-blocker",
  MRA: "MRA",
  SGLT2i: "SGLT2i",
};
