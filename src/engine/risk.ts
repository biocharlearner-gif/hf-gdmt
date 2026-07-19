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
import { THRESHOLDS } from "./codes";

export type RiskBand = "Stable" | "Low" | "Moderate" | "High" | "Critical";

export interface RiskContributor {
  title: string;
  /** Present for vital-derived contributors; absent for non-vital signals (e.g. a hospitalization). */
  vital?: GdmtAlert["vital"];
  points: number;
  /** Guideline citation id for the contributor, if any. */
  citationRef?: string;
}

/** A recent HF-related inpatient stay — a strong, non-vital driver of near-term risk. */
export interface HospitalizationSignal {
  /** Days since the most recent HF hospitalization's discharge (or admission if ongoing). */
  daysSinceDischarge: number;
  /** ISO date the stay ended (or started), for display. */
  when?: string;
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

/** Points a recent HF hospitalization adds, by how fresh the discharge is. */
const HOSP_VULNERABLE_POINTS = 40; // within the vulnerable phase — near a "high" driver
const HOSP_RECENT_POINTS = 18;     // recent but past the vulnerable window
const HOSP_CITATION = "AHA-ACC-HFSA-2022-8-transitions";

function bandFor(score: number): RiskBand {
  if (score >= 70) return "Critical";
  if (score >= 45) return "High";
  if (score >= 20) return "Moderate";
  if (score > 0) return "Low";
  return "Stable";
}

/** Points a hospitalization signal adds now, by recency window (0 once it's old). */
function hospitalizationContributor(h: HospitalizationSignal): RiskContributor | undefined {
  const d = h.daysSinceDischarge;
  if (d < 0) return undefined;
  let points = 0;
  if (d <= THRESHOLDS.hfHospVulnerableDays) points = HOSP_VULNERABLE_POINTS;
  else if (d <= THRESHOLDS.hfHospRecentDays) points = HOSP_RECENT_POINTS;
  else return undefined;
  const phase = d <= THRESHOLDS.hfHospVulnerableDays ? "vulnerable phase" : "recent";
  return { title: `HF hospitalization (${phase}, ${d}d ago)`, points, citationRef: HOSP_CITATION };
}

/**
 * Compute the risk score from a patient's current alerts, plus an optional recent
 * HF hospitalization. Empty inputs → 0 / "Stable". Pure and deterministic; the
 * contributors list makes every point auditable.
 */
export function computeRiskScore(
  alerts: GdmtAlert[],
  opts?: { hospitalization?: HospitalizationSignal },
): RiskScore {
  const contributors: RiskContributor[] = alerts.map((a) => ({
    title: a.title,
    vital: a.vital,
    points: SEVERITY_POINTS[a.severity],
  }));
  const hosp = opts?.hospitalization ? hospitalizationContributor(opts.hospitalization) : undefined;
  if (hosp) contributors.push(hosp);
  const score = Math.min(100, contributors.reduce((sum, c) => sum + c.points, 0));
  return { score, band: bandFor(score), contributors };
}
