import type { PillarId } from "./types";

/**
 * LOINC / SNOMED constants used when extracting data from FHIR.
 * VERIFY against current code-system releases before production use.
 */
export const LOINC = {
  LVEF: ["10230-1", "8806-2"],
  EGFR: ["33914-3", "62238-1", "48642-3", "48643-1"],
  CREATININE: ["2160-0"],
  POTASSIUM: ["2823-3"],
  NT_PROBNP: ["33762-6"],
  BNP: ["30934-4"],
  SBP: ["8480-6"],
  DBP: ["8462-4"],
  HEART_RATE: ["8867-4"],
  BODY_WEIGHT: ["29463-7", "3141-9", "8350-1"], // measured / stated body weight
  SPO2: ["59408-5", "2708-6"],                   // SpO2 by pulse ox / oxygen saturation
} as const;

export const SNOMED = {
  HEART_FAILURE: "84114007",
  HFREF: "703272007",
} as const;

/**
 * Pillar value sets. In production, resolve these from VSAC / RxNorm rather than
 * matching on ingredient names. The name list below is a pragmatic starter that
 * classifies the common evidence-based agents. Extend freely.
 *
 * RAASi is split into ARNI (preferred) / ACEi / ARB but all roll up to the single
 * "RAASi" pillar for scoring.
 */
export const PILLAR_INGREDIENTS: Record<PillarId, string[]> = {
  RAASi: [
    // ARNI (preferred)
    "sacubitril", "sacubitril/valsartan", "sacubitril / valsartan", "entresto",
    // ACE inhibitors
    "lisinopril", "enalapril", "ramipril", "captopril", "perindopril", "trandolapril", "fosinopril",
    // ARBs
    "losartan", "valsartan", "candesartan", "irbesartan", "olmesartan", "telmisartan",
  ],
  BetaBlocker: [
    // evidence-based beta-blockers for HFrEF
    "carvedilol", "metoprolol succinate", "metoprolol", "bisoprolol",
  ],
  MRA: ["spironolactone", "eplerenone"],
  SGLT2i: ["dapagliflozin", "empagliflozin", "sotagliflozin", "canagliflozin"],
};

/** Returns true if a med name belongs to the ARNI subclass (preferred RAASi). */
export function isArni(name: string): boolean {
  const n = name.toLowerCase();
  return n.includes("sacubitril") || n.includes("entresto");
}

/**
 * Target daily doses (mg/day) for common agents, used for dose-adequacy.
 * Simplified starter table — confirm against guideline/label.
 */
export const TARGET_DOSE_MG: Record<string, number> = {
  // RAASi
  "sacubitril/valsartan": 194 + 206, // target 97/103 mg BID -> ~400 mg/day combined salt
  "entresto": 400,
  lisinopril: 40,
  enalapril: 40,
  ramipril: 10,
  losartan: 150,
  valsartan: 320,
  candesartan: 32,
  // Beta-blockers
  carvedilol: 50,
  "metoprolol succinate": 200,
  metoprolol: 200,
  bisoprolol: 10,
  // MRA
  spironolactone: 50,
  eplerenone: 50,
  // SGLT2i (fixed dose — "at target" if on it)
  dapagliflozin: 10,
  empagliflozin: 10,
};

/** Clinical gating thresholds (configurable). VERIFY against guideline. */
export const THRESHOLDS = {
  hfrefLvefMax: 40,
  hfmrefLvefMax: 49,
  potassiumHoldMra: 5.0,      // hold MRA if K+ > this
  potassiumHoldRaasi: 5.5,    // hold RAASi if K+ > this
  egfrMinMra: 30,
  egfrMinRaasi: 30,
  egfrMinSglt2i: 20,
  sbpMinRaasi: 100,           // ARNI initiation preference
  sbpMinAcearb: 90,
  sbpMinBetaBlocker: 90,
  hrMinBetaBlocker: 60,
  // recency windows (days)
  labRecencyDays: 90,
  vitalRecencyDays: 90,
  lvefRecencyDays: 365,
  // dose-adequacy: >= this fraction of target counts as ON_TARGET
  onTargetFraction: 0.9,
} as const;

/**
 * Remote-monitoring alert thresholds for HF patient-device vitals.
 * These detect early decompensation / titration-safety concerns from home devices
 * (scale, BP cuff, pulse, pulse-ox). Every rule traces to an authentic source
 * (2022 AHA/ACC/HFSA HF guideline & HFSA self-care guidance) and was clinician-reviewed
 * on 2026-06-20 — the implementation faithfully matches the cited guidance. Treat these
 * as cited config constants, NOT user-editable (see docs/DECISIONS.md "Remote-monitoring
 * alerts"). Weights are stored in kg (clinical SI); lb equivalents are noted.
 */
export const ALERT_THRESHOLDS = {
  // Fluid-retention / decompensation (HFSA self-care guidance).
  weightGain1dKg: 0.9, // ~2 lb overnight
  weightGain7dKg: 2.3, // ~5 lb in a week
  weightWindow1dDays: 1.5, // tolerance window for an "overnight" comparison
  weightWindow7dDays: 7,
  // Titration-safety vitals (GDMT initiation/up-titration limits).
  sbpMinAlert: 90, // symptomatic hypotension limits ARNI/ACEi/ARB & SGLT2i
  hrMinAlert: 50, // bradycardia limits beta-blocker
  hrMaxAlert: 100, // sustained resting tachycardia
  // General red flag (cite cautiously — not HF-specific).
  spo2MinAlert: 90,
  // Ignore readings older than this for alerting (days).
  vitalAlertRecencyDays: 14,
  // --- Predictive / trend rules (early warning BEFORE a hard threshold breach) ---
  // Rising-weight trend: a run of N consecutive increasing daily readings whose total
  // gain is meaningful but still under the acute 7-day threshold → early heads-up.
  weightRisingRun: 3, // consecutive increasing readings (>=3 points)
  weightRisingMinTotalKg: 0.6, // cumulative gain across the run to flag (below weightGain7dKg)
  // Declining-SpO2 trend: relative % drop across a short window while still >= the acute
  // floor — catches a downward slide before it crosses 90%.
  spo2DeclinePct: 4, // relative % decline over the window
  spo2DeclineWindowDays: 3,
} as const;

export function classifyMed(name: string): PillarId | null {
  const n = name.toLowerCase().trim();
  for (const [pillar, names] of Object.entries(PILLAR_INGREDIENTS) as [PillarId, string[]][]) {
    if (names.some((drug) => n.includes(drug))) return pillar;
  }
  return null;
}
