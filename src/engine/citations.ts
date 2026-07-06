/**
 * Citation registry — resolves the opaque `citationRef` ids the engine emits into a
 * human label, the source document, the specific section, and a deep link.
 *
 * Keeping this as data (not logic) preserves the "engine decides, citations are
 * reference data" split: rules carry only a ref id; the UI renders the authoritative
 * source + a clickable link so a clinician can verify the basis of every alert.
 */
export interface Citation {
  /** Short source name, e.g. "2022 AHA/ACC/HFSA HF Guideline". */
  source: string;
  /** The exact part of the source, e.g. "§7.3.1 — RAAS inhibition". */
  section: string;
  /** Deep link to the source document (opens in a new tab). Omit if none. */
  url?: string;
}

/** Canonical link for the 2022 AHA/ACC/HFSA Heart Failure Guideline (Circulation). */
const HF_GUIDELINE_URL = "https://www.ahajournals.org/doi/10.1161/CIR.0000000000001063";

export const CITATIONS: Record<string, Citation> = {
  "AHA-ACC-HFSA-2022-7.3.1": { source: "2022 AHA/ACC/HFSA HF Guideline", section: "§7.3.1 — RAAS inhibition (ARNI/ACEi/ARB)", url: HF_GUIDELINE_URL },
  "AHA-ACC-HFSA-2022-7.3.2": { source: "2022 AHA/ACC/HFSA HF Guideline", section: "§7.3.2 — Beta-blockers", url: HF_GUIDELINE_URL },
  "AHA-ACC-HFSA-2022-7.3.3": { source: "2022 AHA/ACC/HFSA HF Guideline", section: "§7.3.3 — MRA", url: HF_GUIDELINE_URL },
  "AHA-ACC-HFSA-2022-7.3.4": { source: "2022 AHA/ACC/HFSA HF Guideline", section: "§7.3.4 — SGLT2 inhibitors", url: HF_GUIDELINE_URL },
  // Daily-weight self-monitoring guidance lives in the same joint guideline (HFSA co-author).
  "HFSA-selfcare-weight-monitoring": { source: "2022 AHA/ACC/HFSA HF Guideline", section: "§10.1 — Self-care: daily weight monitoring", url: HF_GUIDELINE_URL },
  "general-red-flag-spo2": { source: "General clinical red flag", section: "Low oxygen saturation (not HF-specific)" },
};

/** Resolve a ref to a Citation, falling back to the raw ref if unknown. */
export function resolveCitation(ref: string): Citation {
  return CITATIONS[ref] ?? { source: ref, section: "" };
}
