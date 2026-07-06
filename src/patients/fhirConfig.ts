/**
 * Configuration for the Patient Management module.
 *
 * This module talks to a PUBLIC, open FHIR R4 server (no SMART auth) — distinct
 * from the Epic SMART-on-FHIR flow used by the GDMT optimizer. The endpoint is
 * configuration, never hardcoded into the call sites, mirroring the convention
 * in src/fhirClient.ts.
 */

/** HAPI public R4 test server — open, full CRUD, supports _offset/_count paging. */
export const PATIENT_FHIR_BASE = "https://hapi.fhir.org/baseR4";

/**
 * Terminology server for value-set $expand (SNOMED ECL). Separate from the data
 * server above: the public HAPI has no SNOMED loaded, so expansion must run against
 * a SNOMED-capable tx server. Config, never hardcoded into call sites.
 *
 * Uses CSIRO Ontoserver: it sends clean, single CORS headers so browser $expand
 * works. (tx.fhir.org emits DUPLICATE Access-Control-Allow-Origin headers, which
 * browsers reject with "Failed to fetch" — usable only server-side.)
 */
export const TERMINOLOGY_BASE = "https://r4.ontoserver.csiro.au/fhir";

/** Root SNOMED concept for the HF cohort — expanded via ECL «<< 84114007». */
export const HF_ROOT_SNOMED = "84114007";

/** Identifier system under which we store the Medical Record Number. */
export const MRN_SYSTEM = "urn:hf-gdmt:mrn";

/**
 * Tag that scopes the demo cohort on the shared public HAPI server. The patient
 * list filters to this tag so it shows only our seeded HF cohort and ignores the
 * unrelated data other people put on hapi.fhir.org. Set by scripts/seed-hapi.mjs.
 * (Remove this scoping once we move to a dedicated/stable server.)
 */
export const COHORT_TAG = "urn:hf-gdmt:demo|cohort-v1";

/** v2-0203 "MR" (Medical Record Number) identifier type coding. */
export const MRN_TYPE = {
  system: "http://terminology.hl7.org/CodeSystem/v2-0203",
  code: "MR",
} as const;
