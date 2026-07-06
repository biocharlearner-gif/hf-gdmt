/**
 * HF congestion / decompensation risk score — a single 0–100 number per patient that
 * answers "how concerning are this patient's vitals today?". It is a deterministic,
 * fully-explainable roll-up of the alerts the engine already produced (severity-
 * weighted) — no new thresholds, no AI. Higher = more concerning.
 *
 * Purpose: let a care team triage a cohort (sort the sickest to the top) and show, on
 * one patient, what is driving the concern. Stays on-thesis: the engine decides.
 */
import type { GdmtAlert, AlertSeverity } from "./alerts";

export type RiskBand = "Stable" | "Low" | "Moderate" | "High" | "Critical";

export interface RiskContributor {
  title: string;
  vital: GdmtAlert["vital"];
  points: number;
}

export interface RiskScore {
  score: number; // 0–100
  band: RiskBand;
  contributors: RiskContributor[];
}

/** Points each alert contributes, by severity. Tuned so one high alert = "High" band. */
const SEVERITY_POINTS: Record<AlertSeverity, number> = {
  high: 45,
  moderate: 22,
  low: 10,
};

function bandFor(score: number): RiskBand {
  if (score >= 70) return "Critical";
  if (score >= 45) return "High";
  if (score >= 20) return "Moderate";
  if (score > 0) return "Low";
  return "Stable";
}

/**
 * Compute the risk score from a patient's current alerts. Empty alerts → 0 / "Stable".
 * Pure and deterministic; the contributors list makes every point auditable.
 */
export function computeRiskScore(alerts: GdmtAlert[]): RiskScore {
  const contributors = alerts.map((a) => ({
    title: a.title,
    vital: a.vital,
    points: SEVERITY_POINTS[a.severity],
  }));
  const score = Math.min(100, contributors.reduce((sum, c) => sum + c.points, 0));
  return { score, band: bandFor(score), contributors };
}
