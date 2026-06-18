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

export function classifyMed(name: string): PillarId | null {
  const n = name.toLowerCase().trim();
  for (const [pillar, names] of Object.entries(PILLAR_INGREDIENTS) as [PillarId, string[]][]) {
    if (names.some((drug) => n.includes(drug))) return pillar;
  }
  return null;
}
