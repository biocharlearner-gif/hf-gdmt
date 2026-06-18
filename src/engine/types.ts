/**
 * Engine data model. The engine is intentionally decoupled from FHIR:
 * FHIR bundles are parsed into `EngineInput` by `src/fhir/extract.ts`, and the
 * pure rule engine in `src/engine/*` only ever sees these plain types. This keeps
 * the clinical logic fully unit-testable without any network or FHIR coupling.
 */

export type Phenotype = "HFrEF" | "HFmrEF" | "HFpEF" | "Unknown";

export type PillarId = "RAASi" | "BetaBlocker" | "MRA" | "SGLT2i";

export type PillarStatus =
  | "ON_TARGET"        // on an agent at (or near) target dose
  | "ON_SUBTARGET"     // on an agent below target dose
  | "GAP_ELIGIBLE"     // not on it, eligible now -> recommend + offer Task
  | "GAP_LABS_NEEDED"  // not on it, but gating labs missing/stale -> order labs first
  | "CONTRAINDICATED"  // not on it, and should not be (state the reason)
  | "INSUFFICIENT_DATA";

/** A measured value with the date it was effective, used for recency checks. */
export interface Dated<T> {
  value: T;
  date?: string; // ISO date string
}

export interface MedicationFact {
  /** Which pillar class this medication maps to (resolved via value sets). */
  pillar: PillarId | null;
  /** RxNorm code if known. */
  rxnorm?: string;
  /** Ingredient/display name (lowercased match is used as a fallback classifier). */
  name: string;
  /** Total daily dose in mg if parseable, else undefined. */
  dailyDoseMg?: number;
  active: boolean;
}

export interface EngineInput {
  patientId: string;
  now: string; // ISO date; injected for deterministic recency checks (no Date.now in engine)
  lvef?: Dated<number>;          // %
  medications: MedicationFact[];
  labs: {
    potassium?: Dated<number>;   // mmol/L
    egfr?: Dated<number>;        // mL/min/1.73m2
    creatinine?: Dated<number>;  // mg/dL
  };
  vitals: {
    systolicBp?: Dated<number>;  // mmHg
    heartRate?: Dated<number>;   // bpm
  };
  flags: {
    angioedemaHistory?: boolean;
    pregnancy?: boolean;
    type1Diabetes?: boolean;
  };
}

export interface PillarResult {
  id: PillarId;
  label: string;
  status: PillarStatus;
  /** Detected agent if patient is on this pillar. */
  agent?: { name: string; dailyDoseMg?: number; targetDoseMg?: number; doseFraction?: number };
  /** Human-readable explanation of the status. */
  reason: string;
  /** The lab/vital values the decision was based on (for transparency). */
  gating: Record<string, number | undefined>;
  /** Guideline citation id (resolved to text in the UI). */
  citationRef: string;
  /** If a Task should be offered, a ready-to-build description. */
  suggestedAction?: { kind: "INITIATE" | "UPTITRATE" | "ORDER_LABS"; text: string };
}

export interface GdmtAssessment {
  patientId: string;
  phenotype: Phenotype;
  lvef?: number;
  /** 0–4: pillars on therapy. */
  gdmtScore: number;
  /** Fraction of eligible pillars at target dose (0–1). */
  optimizationPct: number;
  pillars: PillarResult[];
  /** Pillars flagged GAP_LABS_NEEDED, summarised for ServiceRequest creation. */
  labsNeeded: string[];
  generatedAt: string;
}
