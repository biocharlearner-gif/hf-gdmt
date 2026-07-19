import type { FhirResource } from "./patientApi";
import { LOINC, THRESHOLDS } from "../engine/codes";

/**
 * The GDMT-relevant lab panel and the pure shaping of FHIR Observations into per-analyte
 * series for the Clinical tab's Labs view.
 *
 * This module **displays**; it does not decide. Reference-range flags below are ordinary
 * physiologic ranges — they say "this value is abnormal", never "do something about it".
 * The pillar gating each analyte drives lives in `gdmtNote` as a static string whose
 * numbers are interpolated from the engine's own `THRESHOLDS`, so the gate a clinician
 * reads here can never drift from the gate the engine applies (see CLAUDE.md: the engine
 * decides, everything else only explains).
 *
 * LOINC codes come from `engine/codes.ts` rather than being redeclared here.
 */

export type LabFlag = "low" | "high" | "normal";

export interface LabDef {
  key: string;
  label: string;
  /** LOINC codes that identify this analyte, from `engine/codes.ts`. */
  loinc: readonly string[];
  unit: string;
  /**
   * Decimal places this analyte is reported to. Explicit per analyte because trailing
   * zeros carry meaning in a lab result — creatinine is "1.00 mg/dL", not "1".
   */
  decimals: number;
  /** Physiologic reference range. Drives the abnormal flag only — not a GDMT gate. */
  refLow?: number;
  refHigh?: number;
  /** Which GDMT decision this analyte feeds. Descriptive; never an instruction. */
  gdmtNote: string;
}

/** Render a value at its analyte's reported precision. */
export function fmtLabValue(def: LabDef, value: number): string {
  return value.toFixed(def.decimals);
}

export const LAB_PANEL: readonly LabDef[] = [
  {
    key: "potassium",
    label: "Potassium",
    loinc: LOINC.POTASSIUM,
    unit: "mmol/L",
    decimals: 1,
    refLow: 3.5,
    refHigh: 5.0,
    gdmtNote: `Gates MRA (> ${THRESHOLDS.potassiumHoldMra} mmol/L) and RAASi (> ${THRESHOLDS.potassiumHoldRaasi} mmol/L)`,
  },
  {
    key: "egfr",
    label: "eGFR",
    loinc: LOINC.EGFR,
    unit: "mL/min/1.73m²",
    decimals: 0,
    refLow: 60,
    gdmtNote: `Gates MRA and RAASi (≥ ${THRESHOLDS.egfrMinMra}) and SGLT2i (≥ ${THRESHOLDS.egfrMinSglt2i})`,
  },
  {
    key: "creatinine",
    label: "Creatinine",
    loinc: LOINC.CREATININE,
    unit: "mg/dL",
    decimals: 2,
    refLow: 0.6,
    refHigh: 1.3,
    gdmtNote: "Tracks renal function alongside eGFR during up-titration",
  },
  {
    key: "ntprobnp",
    label: "NT-proBNP",
    loinc: LOINC.NT_PROBNP,
    unit: "pg/mL",
    decimals: 0,
    refHigh: 125,
    gdmtNote: "Congestion and severity marker; not a pillar gate",
  },
  {
    key: "bnp",
    label: "BNP",
    loinc: LOINC.BNP,
    unit: "pg/mL",
    decimals: 0,
    refHigh: 35,
    gdmtNote: "Congestion and severity marker; not a pillar gate",
  },
  {
    key: "lvef",
    label: "LVEF",
    loinc: LOINC.LVEF,
    unit: "%",
    decimals: 0,
    refLow: 50,
    gdmtNote: `Phenotype gate — HFrEF is LVEF ≤ ${THRESHOLDS.hfrefLvefMax}%`,
  },
];

/** Every LOINC code in the panel, for building the Observation `code=` search param. */
export const LAB_PANEL_LOINCS: readonly string[] = LAB_PANEL.flatMap((d) => [...d.loinc]);

export interface LabPoint {
  value: number;
  unit: string;
  /** Observation.effectiveDateTime, falling back to issued. */
  date: string;
  flag: LabFlag;
}

export interface LabSeries {
  def: LabDef;
  /** Oldest → newest, so a sparkline can render it directly. */
  points: LabPoint[];
  latest?: LabPoint;
  /** % change from the previous point to the latest; null with fewer than 2 points. */
  deltaPct: number | null;
}

interface Coding { code?: string }
interface Obs {
  code?: { coding?: Coding[] };
  valueQuantity?: { value?: number; unit?: string };
  effectiveDateTime?: string;
  issued?: string;
}

function hasLoinc(o: Obs, set: readonly string[]): boolean {
  return (o.code?.coding ?? []).some((c) => c.code && set.includes(c.code));
}

export function flagFor(def: LabDef, value: number): LabFlag {
  if (def.refLow !== undefined && value < def.refLow) return "low";
  if (def.refHigh !== undefined && value > def.refHigh) return "high";
  return "normal";
}

/**
 * Group Observations into one ascending series per panel analyte.
 *
 * Every analyte is returned even when it has no results — "no potassium on file" is
 * itself a GDMT-relevant fact, so the caller renders an explicit empty state rather
 * than the analyte silently disappearing. Observations without a numeric
 * `valueQuantity` or a date are skipped instead of throwing.
 */
export function buildLabSeries(resources: FhirResource[]): LabSeries[] {
  const obs = resources.filter((r) => r.resourceType === "Observation") as unknown as Obs[];

  return LAB_PANEL.map((def) => {
    const points: LabPoint[] = obs
      .filter((o) => hasLoinc(o, def.loinc))
      .map((o) => {
        const value = o.valueQuantity?.value;
        const date = o.effectiveDateTime ?? o.issued;
        if (typeof value !== "number" || !Number.isFinite(value) || typeof date !== "string") return null;
        return { value, unit: o.valueQuantity?.unit ?? def.unit, date, flag: flagFor(def, value) };
      })
      .filter((p): p is LabPoint => p !== null)
      .sort((a, b) => a.date.localeCompare(b.date));

    const latest = points[points.length - 1];
    const prev = points[points.length - 2];
    const deltaPct =
      latest && prev && prev.value !== 0 ? ((latest.value - prev.value) / prev.value) * 100 : null;

    return { def, points, latest, deltaPct };
  });
}
