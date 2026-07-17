/**
 * Heart-Failure cohort value set (Gate 1) — the set of Condition codes that define
 * "this patient is in the HF cohort". Broad on purpose: SNOMED hierarchy under
 * 84114007 |Heart failure| plus the ICD-10 I50.* family.
 *
 * `getHfCodes()` is the single seam the rest of the app calls. It expands the SNOMED
 * HF hierarchy («<< 84114007») on a terminology server and merges the ICD-10 I50.*
 * family. If the tx server is unreachable / SNOMED-less / blocked by CORS, it falls
 * back to the hardcoded set below so a flaky server never blocks the cohort. The
 * expansion is cached for the session (one network call).
 */

import { HF_ROOT_SNOMED, TERMINOLOGY_BASE } from "./fhirConfig";

export interface Coding {
  system: string;
  code: string;
}

const SCT = "http://snomed.info/sct";
const ICD10 = "http://hl7.org/fhir/sid/icd-10";

/** Hardcoded fallback HF value set. VERIFY against the curated value set before production. */
export const HF_FALLBACK_CODES: Coding[] = [
  // SNOMED — heart failure and common descendants
  { system: SCT, code: "84114007" }, // Heart failure
  { system: SCT, code: "703272007" }, // HF with reduced ejection fraction
  { system: SCT, code: "417996009" }, // Systolic heart failure
  { system: SCT, code: "42343007" }, // Congestive heart failure
  { system: SCT, code: "85232009" }, // Left heart failure
  { system: SCT, code: "88805009" }, // Chronic congestive heart failure
  { system: SCT, code: "56675007" }, // Acute heart failure
  // ICD-10 — I50.* family
  { system: ICD10, code: "I50.1" },
  { system: ICD10, code: "I50.20" },
  { system: ICD10, code: "I50.21" },
  { system: ICD10, code: "I50.22" },
  { system: ICD10, code: "I50.23" },
  { system: ICD10, code: "I50.30" },
  { system: ICD10, code: "I50.32" },
  { system: ICD10, code: "I50.33" },
  { system: ICD10, code: "I50.42" },
  { system: ICD10, code: "I50.43" },
  { system: ICD10, code: "I50.9" },
];

/** ICD-10 I50.* family — enumerated (small, finite); not expanded on the tx server. */
const HF_ICD10_CODES: Coding[] = HF_FALLBACK_CODES.filter((c) => c.system === ICD10);

/** Session cache: expand at most once per page load. */
let cache: Promise<Coding[]> | null = null;

/**
 * HF cohort codes: SNOMED hierarchy expanded on the terminology server + ICD-10
 * I50.* family. Falls back to the full hardcoded set on any failure.
 */
export async function getHfCodes(): Promise<Coding[]> {
  if (!cache) cache = loadHfCodes();
  return cache;
}

/**
 * True if a coding is in the HF cohort value set (Gate 1). Used by the Add-Patient
 * diagnosis picker to classify a chosen concept HF vs Non-HF using the SAME expanded
 * set the roster's cohort query uses — so the form's preview and the list agree.
 */
export async function isHfCode(concept: { system: string; code: string }): Promise<boolean> {
  const codes = await getHfCodes();
  return codes.some((c) => c.system === concept.system && c.code === concept.code);
}

async function loadHfCodes(): Promise<Coding[]> {
  try {
    const snomed = await expandHfSnomed();
    if (snomed.length === 0) throw new Error("empty SNOMED expansion");
    return [...snomed, ...HF_ICD10_CODES];
  } catch (err) {
    console.warn("[hfCohort] terminology $expand failed — using hardcoded fallback set:", err);
    return HF_FALLBACK_CODES;
  }
}

/** POST ValueSet/$expand with an ECL «<< 84114007» include; returns SNOMED codings. */
async function expandHfSnomed(): Promise<Coding[]> {
  const valueSet = {
    resourceType: "ValueSet",
    compose: {
      include: [
        { system: SCT, filter: [{ property: "concept", op: "is-a", value: HF_ROOT_SNOMED }] },
      ],
    },
  };
  const url = `${TERMINOLOGY_BASE.replace(/\/$/, "")}/ValueSet/$expand?count=2000`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/fhir+json", Accept: "application/fhir+json" },
    body: JSON.stringify(valueSet),
  });
  if (!res.ok) throw new Error(`$expand ${res.status}`);
  const json = (await res.json()) as {
    expansion?: { contains?: Array<{ system?: string; code?: string }> };
  };
  return (json.expansion?.contains ?? [])
    .filter((c) => c.system === SCT && c.code)
    .map((c) => ({ system: SCT, code: c.code as string }));
}
