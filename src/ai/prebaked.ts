import type { PillarId, PillarStatus } from "../engine/types";

/**
 * Pre-baked, AI-drafted rationale (feature C4 — "Option C").
 *
 * These explanations were drafted by Claude (Opus 4.8) at build time and grounded in the
 * curated knowledge base (`knowledgeBase.ts`) + the engine's decision for each
 * (pillar × status) scenario. They give AI-quality prose with ZERO runtime API cost — no
 * key, no credits — because the engine is deterministic, so the set of explanations is a
 * small finite lookup rather than a per-request LLM call.
 *
 * Grounding & safety (identical to the live-LLM path):
 *  - Value-agnostic on purpose: no specific lab values or doses are baked in — the
 *    patient-specific numbers come from the engine's `reason` (rendered separately), and
 *    the citations come from the retriever. So nothing here can drift from the engine.
 *  - Framed as guideline-based decision support; never an order or auto-prescription.
 *  - Editable: this is a plain static file. Reword any entry (e.g. via a Claude Pro
 *    session) without touching code — the citations and engine facts are unaffected.
 *
 * Precedence at render time: a live Anthropic key (if configured) overrides these;
 * otherwise these are used; the terse deterministic template is the last-resort fallback.
 */

type ScenarioKey = `${PillarId}:${PillarStatus}`;

export const PREBAKED_RATIONALE: Partial<Record<ScenarioKey, string>> = {
  // ---- RAAS inhibitor / ARNI (§7.3.1) --------------------------------------
  "RAASi:GAP_ELIGIBLE":
    "This patient has HFrEF and is not yet on a renin–angiotensin system inhibitor despite meeting the criteria to start one. Guideline-directed therapy recommends a RAAS inhibitor — an ARNI preferred where feasible — to reduce mortality and heart-failure hospitalization, so initiating one is the next step for the care team to consider.",
  "RAASi:ON_SUBTARGET":
    "The patient is on a RAAS inhibitor but below the target dose shown to reduce mortality in trials. Guidelines advise up-titrating toward the target (or maximum tolerated) dose, typically at about two-week intervals as blood pressure and renal function allow.",
  "RAASi:GAP_LABS_NEEDED":
    "A RAAS inhibitor is indicated, but current potassium and renal-function values are needed before starting or adjusting it, since these medicines are renally active. The care team should obtain up-to-date labs first, then initiate.",
  "RAASi:CONTRAINDICATED":
    "A RAAS inhibitor is being withheld because a safety factor makes it inappropriate here — for example a history of angioedema (an absolute contraindication for ARNI and ACE inhibitors) or symptomatic hypotension. The specific factor the engine flagged should guide whether an alternative pathway or watchful waiting is appropriate.",
  "RAASi:INSUFFICIENT_DATA":
    "There isn't enough information to determine this patient's RAAS-inhibitor status. Confirming the current medication list and recent potassium/renal labs will let the engine assess eligibility.",

  // ---- Beta-blocker (§7.3.2) ------------------------------------------------
  "BetaBlocker:GAP_ELIGIBLE":
    "This HFrEF patient is not on one of the three evidence-based beta-blockers — bisoprolol, carvedilol, or sustained-release metoprolol succinate — that reduce mortality. Guidelines recommend starting one in a stable, euvolemic patient, so beta-blockade is the next therapy to consider.",
  "BetaBlocker:ON_SUBTARGET":
    "The patient is on an evidence-based beta-blocker but below the trial target dose. Up-titration toward target (or the maximum tolerated dose) is advised as heart rate and blood pressure allow, since the mortality benefit is dose-related.",
  "BetaBlocker:GAP_LABS_NEEDED":
    "Beta-blocker therapy is indicated; confirm the patient is clinically stable and euvolemic before initiating or increasing the dose.",
  "BetaBlocker:CONTRAINDICATED":
    "A beta-blocker is being held because of a limiting factor such as bradycardia or acute decompensation. Guidelines advise initiating only in stable patients and avoiding up-titration during decompensation; revisit once the limiting factor resolves.",
  "BetaBlocker:INSUFFICIENT_DATA":
    "There isn't enough information to assess beta-blocker status; confirming the current medication list will let the engine evaluate eligibility.",

  // ---- MRA (§7.3.3) ---------------------------------------------------------
  "MRA:GAP_ELIGIBLE":
    "This HFrEF patient is not on a mineralocorticoid receptor antagonist despite potassium and renal function that permit one. An MRA (spironolactone or eplerenone) carries a Class 1 mortality benefit here, so starting one — with follow-up potassium monitoring — is the next step to consider.",
  "MRA:ON_SUBTARGET":
    "The patient is on an MRA below the target dose; up-titration toward target is advised as potassium and renal function permit, with monitoring after each change.",
  "MRA:GAP_LABS_NEEDED":
    "An MRA is indicated, but current potassium and renal-function values are required before starting it because of hyperkalemia risk. Obtain up-to-date labs first, then initiate if they fall within the safe range.",
  "MRA:CONTRAINDICATED":
    "An MRA is being held because a safety threshold is outside the range where it can be started — elevated serum potassium or significantly reduced renal function. Guidelines advise against initiating an MRA in this setting given the hyperkalemia risk; recheck labs and reconsider once values normalize.",
  "MRA:INSUFFICIENT_DATA":
    "There isn't enough information to assess MRA status; confirming the medication list and recent potassium/renal labs will let the engine evaluate eligibility.",

  // ---- SGLT2 inhibitor (§7.3.4) --------------------------------------------
  "SGLT2i:GAP_ELIGIBLE":
    "This patient is not on an SGLT2 inhibitor, which reduces heart-failure hospitalization and cardiovascular death in symptomatic heart failure regardless of diabetes status — and benefits patients across the ejection-fraction spectrum, not only HFrEF. Initiating dapagliflozin or empagliflozin is the next step to consider.",
  "SGLT2i:ON_SUBTARGET":
    "SGLT2 inhibitors are given at a single fixed dose rather than titrated, so an on-therapy patient is generally already at goal; confirm continued tolerance and adherence.",
  "SGLT2i:GAP_LABS_NEEDED":
    "An SGLT2 inhibitor is indicated; confirm renal function is adequate for initiation, then start.",
  "SGLT2i:CONTRAINDICATED":
    "An SGLT2 inhibitor is being withheld because of a limiting factor, such as markedly reduced renal function or another listed contraindication. Revisit once the limiting factor is addressed.",
  "SGLT2i:INSUFFICIENT_DATA":
    "There isn't enough information to assess SGLT2-inhibitor status; confirming the current medication list will let the engine evaluate eligibility.",
};

/** Look up the pre-baked rationale for a (pillar, status) scenario, if one exists. */
export function prebakedRationale(pillarId: PillarId, status: PillarStatus): string | undefined {
  return PREBAKED_RATIONALE[`${pillarId}:${status}` as ScenarioKey];
}
