/**
 * Remote-monitoring alert engine for HF patient-device vitals.
 *
 * Same discipline as the GDMT engine: PURE and DETERMINISTIC (no I/O, no Date.now —
 * `now` is injected). It only DETECTS and CITES; it never acts, orders, or titrates.
 * FHIR device `Observation`s are parsed into `AlertInput` elsewhere; this module only
 * ever sees plain values, so the clinical rules stay fully unit-testable.
 *
 * Scope is intentionally narrow (CLAUDE.md: deep single-domain HF, no generic vitals
 * dashboard): weight-gain decompensation + the vitals that gate GDMT titration.
 */
import type { Dated } from "./types";
import { ALERT_THRESHOLDS as T } from "./codes";

const DAY_MS = 24 * 60 * 60 * 1000;

export type AlertSeverity = "high" | "moderate" | "low";

/** A single device reading with the date it was effective. */
export interface VitalReading {
  value: number;
  date: string; // ISO date string
}

export interface AlertInput {
  patientId: string;
  now: string; // ISO date; injected for deterministic recency checks
  /** Daily home weights in kg, any order; sorted internally. */
  weightSeriesKg?: VitalReading[];
  systolicBp?: Dated<number>; // mmHg
  heartRate?: Dated<number>; // bpm
  spo2?: Dated<number>; // %
  /** SpO2 readings (%) over time, for the declining-trend (predictive) rule. */
  spo2SeriesPct?: VitalReading[];
}

export interface GdmtAlert {
  /** Stable rule id (e.g. "weight-gain-7d"). */
  id: string;
  severity: AlertSeverity;
  /** How the rule fired: a hard threshold breach, or a predictive trend over time. */
  kind: "threshold" | "trend";
  vital: "weight" | "bloodPressure" | "heartRate" | "spo2";
  title: string;
  /** Human-readable reason, including the numbers that fired the rule. */
  detail: string;
  /** The observed value that fired the rule, formatted with units (e.g. "88%"). */
  observed: string;
  /** The reference/threshold it breached, formatted (e.g. "< 90%"). */
  threshold: string;
  /** Guideline citation id (resolved to text in the UI), as elsewhere in the engine. */
  citationRef: string;
  /** The reading(s) that triggered this alert, for provenance/audit. */
  triggeredBy: VitalReading[];
}

function ageInDays(now: string, date: string): number | undefined {
  const d = new Date(date).getTime();
  const n = new Date(now).getTime();
  if (Number.isNaN(d) || Number.isNaN(n)) return undefined;
  return Math.max(0, (n - d) / DAY_MS);
}

/** A dated value counts only if present and within the alert recency window. */
function freshVital(now: string, m: Dated<number> | undefined): VitalReading | undefined {
  if (!m || m.date === undefined) return undefined;
  const age = ageInDays(now, m.date);
  if (age === undefined || age > T.vitalAlertRecencyDays) return undefined;
  return { value: m.value, date: m.date };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function kgToLb(kg: number): number {
  return round1(kg / 0.453592);
}

/**
 * Weight-gain rule: compare the latest reading to the earliest reading within the
 * window. A gain at or above the threshold suggests fluid retention / decompensation.
 */
function weightGainAlert(
  series: VitalReading[],
  now: string,
  opts: { id: string; windowDays: number; thresholdKg: number; severity: AlertSeverity },
): GdmtAlert | undefined {
  if (series.length < 2) return undefined;
  const sorted = [...series].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latest = sorted[sorted.length - 1];
  if (!latest) return undefined;
  // Only alert on a current reading; ignore a stale device that stopped reporting.
  const latestAge = ageInDays(now, latest.date);
  if (latestAge === undefined || latestAge > T.vitalAlertRecencyDays) return undefined;

  const latestTime = new Date(latest.date).getTime();
  const windowStart = latestTime - opts.windowDays * DAY_MS;
  const baseline = sorted.find((r) => new Date(r.date).getTime() >= windowStart && r !== latest);
  if (!baseline) return undefined;

  const gainKg = round1(latest.value - baseline.value);
  if (gainKg < opts.thresholdKg) return undefined;

  return {
    id: opts.id,
    severity: opts.severity,
    kind: "threshold",
    vital: "weight",
    title: "Possible fluid retention — weight gain",
    detail:
      `Weight rose ${gainKg} kg (${kgToLb(gainKg)} lb) over ` +
      `${round1(opts.windowDays)} day(s) — at or above the ${opts.thresholdKg} kg ` +
      `(${kgToLb(opts.thresholdKg)} lb) threshold for possible HF decompensation. ` +
      `Consider clinical review.`,
    observed: `+${gainKg} kg over ${round1(opts.windowDays)} day(s)`,
    threshold: `≥ ${opts.thresholdKg} kg / ${round1(opts.windowDays)} day(s)`,
    citationRef: "HFSA-selfcare-weight-monitoring",
    triggeredBy: [baseline, latest],
  };
}

/**
 * Predictive rising-weight trend: a run of consecutive increasing daily weights whose
 * cumulative gain is meaningful but still UNDER the acute 7-day threshold. Catches
 * fluid accumulation days before the hard breach. Fires only when the acute weight
 * rules did not (see evaluateAlerts).
 */
function weightRisingTrendAlert(series: VitalReading[], now: string): GdmtAlert | undefined {
  if (series.length < T.weightRisingRun) return undefined;
  const sorted = [...series].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latest = sorted[sorted.length - 1];
  if (!latest) return undefined;
  const latestAge = ageInDays(now, latest.date);
  if (latestAge === undefined || latestAge > T.vitalAlertRecencyDays) return undefined;

  // Longest strictly-increasing run ending at the latest reading.
  let runStart = sorted.length - 1;
  while (runStart > 0 && sorted[runStart]!.value > sorted[runStart - 1]!.value) runStart--;
  const run = sorted.slice(runStart);
  if (run.length < T.weightRisingRun) return undefined;

  const totalGain = round1(latest.value - run[0]!.value);
  if (totalGain < T.weightRisingMinTotalKg || totalGain >= T.weightGain7dKg) return undefined;

  return {
    id: "weight-trend-rising",
    severity: "moderate",
    kind: "trend",
    vital: "weight",
    title: "Upward weight trend — watch for fluid retention",
    detail:
      `Weight has risen for ${run.length} consecutive readings (+${totalGain} kg / ` +
      `${kgToLb(totalGain)} lb so far), below the acute ${T.weightGain7dKg} kg threshold. ` +
      `Early sign of possible fluid accumulation — monitor closely.`,
    observed: `+${totalGain} kg over ${run.length} readings`,
    threshold: `rising run ≥ ${T.weightRisingRun}, < ${T.weightGain7dKg} kg acute`,
    citationRef: "HFSA-selfcare-weight-monitoring",
    triggeredBy: [run[0]!, latest],
  };
}

/**
 * Predictive SpO2 decline: a relative drop across a short window while the latest is
 * still at/above the acute floor — flags a downward slide before it crosses 90%.
 * Fires only when the acute hypoxia rule did not.
 */
function spo2DeclineTrendAlert(series: VitalReading[], now: string): GdmtAlert | undefined {
  if (series.length < 2) return undefined;
  const sorted = [...series].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latest = sorted[sorted.length - 1];
  if (!latest) return undefined;
  const latestAge = ageInDays(now, latest.date);
  if (latestAge === undefined || latestAge > T.vitalAlertRecencyDays) return undefined;
  if (latest.value < T.spo2MinAlert) return undefined; // acute rule owns this

  const windowStart = new Date(latest.date).getTime() - T.spo2DeclineWindowDays * DAY_MS;
  const baseline = sorted.find((r) => new Date(r.date).getTime() >= windowStart && r !== latest);
  if (!baseline || baseline.value === 0) return undefined;

  const declinePct = round1(((baseline.value - latest.value) / baseline.value) * 100);
  if (declinePct < T.spo2DeclinePct) return undefined;

  return {
    id: "spo2-trend-decline",
    severity: "moderate",
    kind: "trend",
    vital: "spo2",
    title: "Declining oxygen saturation trend",
    detail:
      `SpO₂ fell ${declinePct}% (from ${baseline.value}% to ${latest.value}%) over ` +
      `${T.spo2DeclineWindowDays} day(s), still above the ${T.spo2MinAlert}% floor. ` +
      `Downward trend — review before it crosses the threshold.`,
    observed: `${declinePct}% drop (→ ${latest.value}%)`,
    threshold: `≥ ${T.spo2DeclinePct}% over ${T.spo2DeclineWindowDays} day(s)`,
    citationRef: "general-red-flag-spo2",
    triggeredBy: [baseline, latest],
  };
}

/**
 * Evaluate HF remote-monitoring alerts. Returns highest-concern alerts; an empty
 * array means nothing fired (NOT an error). The caller decides how to surface them
 * (DetectedIssue / Flag / Task) — this module never acts.
 */
export function evaluateAlerts(input: AlertInput): GdmtAlert[] {
  const alerts: GdmtAlert[] = [];
  const series = input.weightSeriesKg ?? [];

  // Weight: report the more urgent (7-day) finding first, then overnight.
  const week = weightGainAlert(series, input.now, {
    id: "weight-gain-7d",
    windowDays: T.weightWindow7dDays,
    thresholdKg: T.weightGain7dKg,
    severity: "high",
  });
  const overnight = weightGainAlert(series, input.now, {
    id: "weight-gain-1d",
    windowDays: T.weightWindow1dDays,
    thresholdKg: T.weightGain1dKg,
    severity: "moderate",
  });
  if (week) alerts.push(week);
  if (overnight) alerts.push(overnight);
  // Predictive: only when no acute weight alert already fired.
  if (!week && !overnight) {
    const rising = weightRisingTrendAlert(series, input.now);
    if (rising) alerts.push(rising);
  }

  const sbp = freshVital(input.now, input.systolicBp);
  if (sbp && sbp.value < T.sbpMinAlert) {
    alerts.push({
      id: "hypotension",
      severity: "moderate",
      kind: "threshold",
      vital: "bloodPressure",
      title: "Low blood pressure — titration-limiting",
      detail:
        `Systolic BP ${sbp.value} mmHg is below ${T.sbpMinAlert} mmHg. May limit ` +
        `ARNI/ACEi/ARB and SGLT2i initiation or up-titration; check for symptoms.`,
      observed: `${sbp.value} mmHg`,
      threshold: `< ${T.sbpMinAlert} mmHg`,
      citationRef: "AHA-ACC-HFSA-2022-7.3.1",
      triggeredBy: [sbp],
    });
  }

  const hr = freshVital(input.now, input.heartRate);
  if (hr && hr.value < T.hrMinAlert) {
    alerts.push({
      id: "bradycardia",
      severity: "moderate",
      kind: "threshold",
      vital: "heartRate",
      title: "Bradycardia — beta-blocker-limiting",
      detail:
        `Heart rate ${hr.value} bpm is below ${T.hrMinAlert} bpm, which limits ` +
        `beta-blocker initiation or up-titration.`,
      observed: `${hr.value} bpm`,
      threshold: `< ${T.hrMinAlert} bpm`,
      citationRef: "AHA-ACC-HFSA-2022-7.3.2",
      triggeredBy: [hr],
    });
  } else if (hr && hr.value > T.hrMaxAlert) {
    alerts.push({
      id: "tachycardia",
      severity: "low",
      kind: "threshold",
      vital: "heartRate",
      title: "Resting tachycardia",
      detail: `Resting heart rate ${hr.value} bpm is above ${T.hrMaxAlert} bpm.`,
      observed: `${hr.value} bpm`,
      threshold: `> ${T.hrMaxAlert} bpm`,
      citationRef: "AHA-ACC-HFSA-2022-7.3.2",
      triggeredBy: [hr],
    });
  }

  const spo2 = freshVital(input.now, input.spo2);
  if (spo2 && spo2.value < T.spo2MinAlert) {
    alerts.push({
      id: "hypoxia",
      severity: "high",
      kind: "threshold",
      vital: "spo2",
      title: "Low oxygen saturation",
      detail: `SpO₂ ${spo2.value}% is below ${T.spo2MinAlert}%.`,
      observed: `${spo2.value}%`,
      threshold: `< ${T.spo2MinAlert}%`,
      citationRef: "general-red-flag-spo2",
      triggeredBy: [spo2],
    });
  } else {
    // Predictive: only when no acute hypoxia fired.
    const decline = spo2DeclineTrendAlert(input.spo2SeriesPct ?? [], input.now);
    if (decline) alerts.push(decline);
  }

  return alerts;
}
