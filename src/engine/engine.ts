import type { EngineInput, GdmtAssessment, Phenotype, PillarResult } from "./types";
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

export * from "./types";
export { THRESHOLDS } from "./codes";
