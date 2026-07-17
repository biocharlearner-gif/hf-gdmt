/**
 * Live diagnosis search against the terminology server (SNOMED CT), used by the
 * Add-Patient diagnosis picker. This is the write-side counterpart to the cohort
 * $expand in hfCohort.ts — same server (Ontoserver), same "clean CORS" reason.
 *
 * We expand the implicit SNOMED value set constrained by ECL to disorders
 * («<< 64572001 |Disease|») with a text `filter`, so the clinician can pick ANY
 * coded diagnosis rather than a fixed dropdown. HF-vs-Non-HF classification is then
 * computed deterministically against the HF cohort value set (see hfCohort.isHfCode)
 * — the engine/cohort still decides membership, the tx server only supplies concepts.
 */

import { TERMINOLOGY_BASE } from "./fhirConfig";

const SCT = "http://snomed.info/sct";

export interface ConceptOption {
  system: string;
  code: string;
  display: string;
}

/** ECL implicit value set: SNOMED disorders, text-filtered. */
const SNOMED_DISORDERS_VS = "http://snomed.info/sct?fhir_vs=ecl/<< 64572001";

/**
 * Search SNOMED disorders by free text via ValueSet/$expand. Returns up to 20
 * concepts. Throws on any HTTP/network error so the caller can fall back to a
 * curated list (graceful degradation — a flaky tx server never blocks Add Patient).
 */
export async function searchSnomedConditions(query: string, signal?: AbortSignal): Promise<ConceptOption[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const params = new URLSearchParams();
  params.set("url", SNOMED_DISORDERS_VS);
  params.set("filter", q);
  params.set("count", "20");
  params.set("activeOnly", "true");
  params.set("includeDesignations", "false");

  const url = `${TERMINOLOGY_BASE.replace(/\/$/, "")}/ValueSet/$expand?${params.toString()}`;
  const res = await fetch(url, { headers: { Accept: "application/fhir+json" }, signal });
  if (!res.ok) throw new Error(`$expand ${res.status}`);

  const json = (await res.json()) as {
    expansion?: { contains?: Array<{ system?: string; code?: string; display?: string }> };
  };
  return (json.expansion?.contains ?? [])
    .filter((c) => c.code && c.display)
    .map((c) => ({ system: c.system ?? SCT, code: c.code as string, display: c.display as string }));
}

/** Human-friendly code-system label for the option secondary line. */
export function systemShortName(system: string): string {
  if (system === SCT) return "SNOMED CT";
  if (system === "http://hl7.org/fhir/sid/icd-10") return "ICD-10";
  return system;
}
