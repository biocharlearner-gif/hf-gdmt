/**
 * Curated problem-list (diagnosis) options offered when adding a patient.
 *
 * Selecting one drives TWO things on save (see patientMapper.formToCondition):
 *  - a coded, active + confirmed `Condition` (category = problem-list-item) is
 *    written for the patient, and
 *  - whether the patient lands in the **HF cohort** (Gate 1) or is a **Non-HF**
 *    patient. HF options are coded with SNOMED descendants of 84114007 |Heart
 *    failure| / ICD-10 I50.* — the same value set the cohort query expands — so an
 *    HF selection is provably picked up by `fetchHfCohortIds`. Non-HF options are
 *    deliberately outside that value set.
 *
 * Codes mirror the seeded demo cohort (scripts/seed-hapi.mjs) so added patients
 * behave identically to the seeded ones.
 */

const SCT = "http://snomed.info/sct";
const ICD10 = "http://hl7.org/fhir/sid/icd-10";

/** One-line cohort definitions — reused in the Add dialog and the roster tooltips. */
export const HF_COHORT_HINT =
  "Confirmed heart-failure diagnosis — eligible for the four-pillar guideline-directed medical therapy (GDMT) program (HFrEF only).";
export const NON_HF_COHORT_HINT =
  "Confirmed diagnosis other than heart failure (e.g. hypertension, diabetes) — kept on the roster for context, but outside the GDMT workflow.";

export interface ProblemOption {
  /** Stable form value / option key. */
  value: string;
  label: string;
  cohort: "hf" | "non-hf";
  coding: { system: string; code: string; display: string };
}

export const PROBLEM_OPTIONS: ProblemOption[] = [
  // Heart failure → enters the four-pillar GDMT (HFrEF) program.
  { value: "hf-hfref", cohort: "hf", label: "Heart failure with reduced ejection fraction (HFrEF)",
    coding: { system: SCT, code: "703272007", display: "Heart failure with reduced ejection fraction" } },
  { value: "hf-systolic", cohort: "hf", label: "Systolic heart failure",
    coding: { system: SCT, code: "417996009", display: "Systolic heart failure" } },
  { value: "hf-congestive", cohort: "hf", label: "Congestive heart failure",
    coding: { system: SCT, code: "42343007", display: "Congestive heart failure" } },
  { value: "hf-chronic-systolic", cohort: "hf", label: "Chronic systolic (congestive) heart failure",
    coding: { system: ICD10, code: "I50.22", display: "Chronic systolic (congestive) heart failure" } },
  { value: "hf-unspecified", cohort: "hf", label: "Heart failure, unspecified",
    coding: { system: ICD10, code: "I50.9", display: "Heart failure, unspecified" } },

  // Non-HF → recorded for context, outside the GDMT workflow.
  { value: "nonhf-htn", cohort: "non-hf", label: "Hypertensive disorder",
    coding: { system: SCT, code: "38341003", display: "Hypertensive disorder" } },
  { value: "nonhf-dm", cohort: "non-hf", label: "Diabetes mellitus",
    coding: { system: SCT, code: "73211009", display: "Diabetes mellitus" } },
  { value: "nonhf-ckd", cohort: "non-hf", label: "Chronic kidney disease",
    coding: { system: SCT, code: "709044004", display: "Chronic kidney disease" } },
  { value: "nonhf-afib", cohort: "non-hf", label: "Atrial fibrillation",
    coding: { system: SCT, code: "49436004", display: "Atrial fibrillation" } },
  { value: "nonhf-copd", cohort: "non-hf", label: "Chronic obstructive pulmonary disease",
    coding: { system: SCT, code: "13645005", display: "Chronic obstructive pulmonary disease" } },
];

export const HF_PROBLEM_OPTIONS = PROBLEM_OPTIONS.filter((o) => o.cohort === "hf");
export const NON_HF_PROBLEM_OPTIONS = PROBLEM_OPTIONS.filter((o) => o.cohort === "non-hf");

export function problemByValue(value: string | undefined): ProblemOption | undefined {
  return value ? PROBLEM_OPTIONS.find((o) => o.value === value) : undefined;
}
