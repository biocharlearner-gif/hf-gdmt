import type { EngineInput, GdmtAssessment, GdmtStage, Phenotype, PillarId, PillarResult } from "./types";
import { THRESHOLDS } from "./codes";
import { PILLARS, evaluatePillar } from "./rules";

export function determinePhenotype(lvef?: number): Phenotype {
  if (lvef === undefined) return "Unknown";
  if (lvef <= THRESHOLDS.hfrefLvefMax) return "HFrEF";
  if (lvef <= THRESHOLDS.hfmrefLvefMax) return "HFmrEF";
  return "HFpEF";
}

const ON_STATUSES = new Set(["ON_TARGET", "ON_SUBTARGET"]);

/**
 * Pure entry point. Given an already-extracted EngineInput, returns the full
 * GDMT assessment. Deterministic: no Date.now, no I/O. Safe to run in the SPA,
 * the CDS Hooks service, and unit tests alike.
 */
export function evaluateGdmt(input: EngineInput): GdmtAssessment {
  const phenotype = determinePhenotype(input.lvef?.value);

  const pillars: PillarResult[] = PILLARS.map((cfg) => evaluatePillar(input, cfg));

  const gdmtScore = pillars.filter((p) => ON_STATUSES.has(p.status)).length;

  // optimization %: of pillars that should be on (on now, or eligible gap), how many at target
  const optimizablePillars = pillars.filter(
    (p) => ON_STATUSES.has(p.status) || p.status === "GAP_ELIGIBLE",
  );
  const atTarget = pillars.filter((p) => p.status === "ON_TARGET").length;
  const optimizationPct =
    optimizablePillars.length === 0 ? 0 : Math.round((atTarget / optimizablePillars.length) * 100) / 100;

  const labsNeeded = pillars
    .filter((p) => p.status === "GAP_LABS_NEEDED")
    .map((p) => p.suggestedAction?.text ?? `Labs needed for ${p.label}`);

  return {
    patientId: input.patientId,
    phenotype,
    lvef: input.lvef?.value,
    gdmtScore,
    optimizationPct,
    pillars,
    labsNeeded: [...new Set(labsNeeded)],
    generatedAt: input.now,
  };
}

/** Whether a pillar is part of the guideline program for this phenotype. */
export function isApplicablePillar(phenotype: Phenotype, pillar: PillarId): boolean {
  if (phenotype === "HFrEF") return true;
  if (phenotype === "HFmrEF" || phenotype === "HFpEF") return pillar === "SGLT2i";
  return false; // Unknown → determine phenotype (echo) first
}

const ACTIONABLE = new Set(["ON_SUBTARGET", "GAP_ELIGIBLE", "GAP_LABS_NEEDED"]);

/**
 * Pure classifier for where the patient sits on the GDMT optimization journey,
 * computed over the pillars applicable to their phenotype. Deterministic — derived
 * entirely from the assessment the engine already produced (no I/O, no Date.now).
 * This is the "you are here" stage a HF clinician reasons in, not an EHR visit type.
 */
export function gdmtStage(assessment: GdmtAssessment): GdmtStage {
  const applicable = assessment.pillars.filter((p) => isApplicablePillar(assessment.phenotype, p.id));
  const applicableCount = applicable.length;
  const atTarget = applicable.filter((p) => p.status === "ON_TARGET").length;
  const started = applicable.filter((p) => ON_STATUSES.has(p.status)).length;
  const actionable = applicable.filter((p) => ACTIONABLE.has(p.status)).length;
  const eligibleGaps = applicable.filter((p) => p.status === "GAP_ELIGIBLE").length;

  // Most recent medication change among on-therapy pillars (smallest days-on-therapy).
  const changeDays = applicable
    .map((p) => p.titration?.daysOnTherapy)
    .filter((d): d is number => typeof d === "number");
  const lastChangeDays = changeDays.length ? Math.min(...changeDays) : undefined;

  const base = { atTarget, applicableCount, eligibleGaps, lastChangeDays };

  if (applicableCount === 0) {
    return {
      ...base,
      id: "PHENOTYPE_PENDING",
      label: "Phenotype pending",
      summary: "LVEF unknown — the GDMT program can't be staged until phenotype is determined.",
      nextStep: "Order an echocardiogram to determine LVEF.",
      tone: "warning",
    };
  }
  if (atTarget === applicableCount) {
    return {
      ...base,
      id: "OPTIMIZED",
      label: "Optimized",
      summary: `All ${applicableCount} applicable pillar${applicableCount > 1 ? "s" : ""} at target dose.`,
      tone: "success",
    };
  }
  if (actionable === 0) {
    return {
      ...base,
      id: "OPTIMIZED_LIMITED",
      label: "Optimized within limits",
      summary: `${atTarget} of ${applicableCount} pillars at target; the rest are limited by contraindications or missing data.`,
      nextStep: "Re-evaluate the blocked pillars if labs, vitals, or tolerance change.",
      tone: "info",
    };
  }
  if (started === 0) {
    return {
      ...base,
      id: "INITIATION",
      label: "Initiation",
      summary: `No GDMT pillars started yet; ${eligibleGaps} eligible to begin now.`,
      nextStep: "Initiate guideline therapy and sequence the four pillars over the coming weeks.",
      tone: "warning",
    };
  }
  return {
    ...base,
    id: "TITRATION",
    label: "Active titration",
    summary: `${atTarget} of ${applicableCount} pillars at target; ${actionable} still to optimize.`,
    nextStep: "Up-titrate sub-target pillars and close eligible gaps at ~2-week intervals.",
    tone: "info",
  };
}

export * from "./types";
export { THRESHOLDS } from "./codes";
