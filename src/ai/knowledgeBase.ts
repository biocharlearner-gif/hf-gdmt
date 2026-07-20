import type { PillarId } from "../engine/types";

/**
 * Curated, cited RAG knowledge base (feature C4). Each chunk is a SHORT, paraphrased
 * guideline statement with a `citationRef` into the citation registry
 * (`src/engine/citations.ts`). This is the "retrieved evidence" layer of the
 * engine-decides / AI-explains split: the deterministic engine emits facts; the
 * retriever (`retrieve.ts`) selects the chunks relevant to those facts; the LLM (or the
 * deterministic renderer) grounds its prose STRICTLY in {engine facts + these chunks}.
 *
 * COPYRIGHT: statements are paraphrased from the 2022 AHA/ACC/HFSA HF Guideline and
 * related self-care guidance — never verbatim guideline text. Keep them short and cited.
 * Verify against the source before trusting a clinical threshold (see codes.ts).
 */

/** A pillar id, or "all" for cross-cutting evidence that applies to every pillar. */
export type KbPillar = PillarId | "all";

export interface KbChunk {
  /** Stable id (used in tests + as the retrieved-evidence key). */
  id: string;
  /** Pillar this evidence pertains to (or "all"). */
  pillar: KbPillar;
  /** Retrieval tags — matched against engine-fact-derived query terms. */
  topics: string[];
  /** Paraphrased, cited guideline statement (short). */
  statement: string;
  /** Citation id resolved to source + section + link via citations.ts. */
  citationRef: string;
}

export const KNOWLEDGE_BASE: KbChunk[] = [
  // ---- RAAS inhibition / ARNI (§7.3.1) --------------------------------------
  {
    id: "raasi-arni-class1",
    pillar: "RAASi",
    topics: ["initiation", "recommendation", "arni", "mortality"],
    statement:
      "In HFrEF, a renin-angiotensin system inhibitor is recommended to reduce mortality and HF hospitalization; an ARNI (sacubitril/valsartan) is preferred over an ACE inhibitor or ARB where feasible (Class 1).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1",
  },
  {
    id: "raasi-acei-arb-alt",
    pillar: "RAASi",
    topics: ["initiation", "alternative", "acei", "arb"],
    statement:
      "When an ARNI is not feasible, an ACE inhibitor is recommended; an ARB is recommended only if the patient is ACE-inhibitor intolerant (e.g. cough).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1",
  },
  {
    id: "raasi-angioedema-contra",
    pillar: "RAASi",
    topics: ["contraindication", "angioedema", "safety"],
    statement:
      "ARNI and ACE inhibitors are contraindicated in patients with a history of angioedema; allow a 36-hour washout when switching from an ACE inhibitor to an ARNI.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1",
  },
  {
    id: "raasi-hypotension-gate",
    pillar: "RAASi",
    topics: ["sbp", "hypotension", "gating", "titration"],
    statement:
      "Symptomatic hypotension limits initiation and up-titration of ARNI/ACEi/ARB; low systolic blood pressure warrants caution and slower titration rather than omission when asymptomatic.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1",
  },

  // ---- Beta-blockers (§7.3.2) ----------------------------------------------
  {
    id: "bb-class1",
    pillar: "BetaBlocker",
    topics: ["initiation", "recommendation", "mortality"],
    statement:
      "In HFrEF, one of the three evidence-based beta-blockers — bisoprolol, carvedilol, or sustained-release metoprolol succinate — is recommended to reduce mortality and hospitalization (Class 1).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.2",
  },
  {
    id: "bb-evidence-based-only",
    pillar: "BetaBlocker",
    topics: ["agent-selection", "safety"],
    statement:
      "Only the three trial-proven beta-blockers confer the mortality benefit in HFrEF; other beta-blockers should not be substituted for GDMT purposes.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.2",
  },
  {
    id: "bb-bradycardia-gate",
    pillar: "BetaBlocker",
    topics: ["hr", "bradycardia", "gating", "titration"],
    statement:
      "Bradycardia limits beta-blocker up-titration; initiate in euvolemic, stable patients and avoid starting or increasing during acute decompensation.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.2",
  },

  // ---- MRA (§7.3.3) ---------------------------------------------------------
  {
    id: "mra-class1",
    pillar: "MRA",
    topics: ["initiation", "recommendation", "mortality"],
    statement:
      "In HFrEF, a mineralocorticoid receptor antagonist (spironolactone or eplerenone) is recommended to reduce mortality and hospitalization when eGFR and serum potassium permit (Class 1).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3",
  },
  {
    id: "mra-renal-k-gate",
    pillar: "MRA",
    topics: ["contraindication", "potassium", "renal", "egfr", "hyperkalemia", "gating"],
    statement:
      "An MRA should not be started when serum potassium is elevated (>5.0 mmol/L) or renal function is significantly impaired (eGFR below ~30 mL/min/1.73m²) because of hyperkalemia risk.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3",
  },
  {
    id: "mra-monitoring",
    pillar: "MRA",
    topics: ["monitoring", "potassium", "renal", "labs"],
    statement:
      "Monitor serum potassium and renal function shortly after starting or up-titrating an MRA, and periodically thereafter, to detect hyperkalemia or worsening renal function early.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3",
  },

  // ---- SGLT2 inhibitors (§7.3.4) -------------------------------------------
  {
    id: "sglt2-class1",
    pillar: "SGLT2i",
    topics: ["initiation", "recommendation", "mortality", "hospitalization"],
    statement:
      "An SGLT2 inhibitor (dapagliflozin or empagliflozin) is recommended in symptomatic HFrEF to reduce HF hospitalization and cardiovascular death, independent of diabetes status (Class 1).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.4",
  },
  {
    id: "sglt2-spectrum",
    pillar: "SGLT2i",
    topics: ["phenotype", "hfmref", "hfpef", "spectrum"],
    statement:
      "SGLT2 inhibitors reduce HF hospitalization across the ejection-fraction spectrum, so they are reasonable in HFmrEF and HFpEF as well as HFrEF — the one pillar that applies beyond reduced EF.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.4",
  },

  // ---- Cross-cutting: titration, sequencing, benefit, transitions ----------
  {
    id: "titration-to-target",
    pillar: "all",
    topics: ["titration", "dose", "target", "uptitration"],
    statement:
      "After initiation, each GDMT medication should be up-titrated to the target dose used in trials (or the maximum tolerated dose), typically at intervals of about two weeks as blood pressure, heart rate, potassium, and renal function allow.",
    citationRef: "AHA-ACC-HFSA-2022-7.3-titration",
  },
  {
    id: "gdmt-sequencing-benefit",
    pillar: "all",
    topics: ["benefit", "sequencing", "mortality", "initiation"],
    statement:
      "Comprehensive, all-four-pillar GDMT produces substantially greater reductions in mortality and hospitalization than partial therapy; rapid sequential or simultaneous initiation of the pillars is encouraged rather than slow one-at-a-time escalation.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1",
  },
  {
    id: "labs-before-titration",
    pillar: "all",
    topics: ["labs", "potassium", "renal", "egfr", "gating", "stale"],
    statement:
      "Current potassium and renal-function values should be available before starting or up-titrating renally-active GDMT (RAAS inhibitors and MRAs); order labs first when values are missing or stale.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3",
  },
  {
    id: "post-discharge-vulnerable",
    pillar: "all",
    topics: ["transitions", "hospitalization", "post-discharge", "vulnerable"],
    statement:
      "GDMT should be initiated and optimized during and soon after an HF hospitalization; the early post-discharge period is a vulnerable phase in which starting or intensifying therapy is especially valuable.",
    citationRef: "AHA-ACC-HFSA-2022-8-transitions",
  },
  {
    id: "phenotype-lvef",
    pillar: "all",
    topics: ["phenotype", "lvef", "hfref", "needs-ef"],
    statement:
      "Left-ventricular ejection fraction defines the HF phenotype and which therapies carry a Class 1 mortality indication; the full four-pillar program is established for HFrEF (LVEF ≤40%), so a current EF is needed before committing to it.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1",
  },
];

/** Look up a chunk by id (used by the retriever and tests). */
export function kbChunk(id: string): KbChunk | undefined {
  return KNOWLEDGE_BASE.find((c) => c.id === id);
}
