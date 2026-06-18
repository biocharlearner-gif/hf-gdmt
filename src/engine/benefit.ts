import type { GdmtAssessment, PillarId } from "./types";

/**
 * Simulated benefit projection (C3 — the demo "wow" feature).
 *
 * Approximate relative risk reductions (RRR) for the primary composite endpoint
 * (CV death / HF hospitalization) from the pivotal HFrEF trials. These are
 * ILLUSTRATIVE figures for a demo and must NOT be presented as patient-specific
 * predictions. Combined effect uses a multiplicative (independent hazards)
 * approximation, which is a simplification used for directional illustration only.
 *
 * Sources to cite in-app: PARADIGM-HF (ARNI), MERIT-HF/CIBIS-II/COPERNICUS
 * (beta-blocker), RALES/EMPHASIS-HF (MRA), DAPA-HF/EMPEROR-Reduced (SGLT2i).
 */
export const PILLAR_RRR: Record<PillarId, number> = {
  RAASi: 0.20,
  BetaBlocker: 0.34,
  MRA: 0.30,
  SGLT2i: 0.26,
};

const ON = new Set(["ON_TARGET", "ON_SUBTARGET"]);

export interface BenefitProjection {
  currentRRR: number;          // vs no GDMT, from pillars currently on
  potentialRRR: number;        // if all eligible gaps were closed
  incrementalRRR: number;      // additional benefit available now
  closeableGaps: PillarId[];
}

function combinedRRR(rrrs: number[]): number {
  // multiplicative: 1 - prod(1 - rrr_i)
  const remaining = rrrs.reduce((acc, r) => acc * (1 - r), 1);
  return Math.round((1 - remaining) * 100) / 100;
}

export function projectBenefit(a: GdmtAssessment): BenefitProjection {
  const onNow = a.pillars.filter((p) => ON.has(p.status)).map((p) => p.id);
  const eligibleGaps = a.pillars.filter((p) => p.status === "GAP_ELIGIBLE").map((p) => p.id);

  const currentRRR = combinedRRR(onNow.map((id) => PILLAR_RRR[id]));
  const potentialRRR = combinedRRR([...onNow, ...eligibleGaps].map((id) => PILLAR_RRR[id]));

  return {
    currentRRR,
    potentialRRR,
    incrementalRRR: Math.round((potentialRRR - currentRRR) * 100) / 100,
    closeableGaps: eligibleGaps,
  };
}
