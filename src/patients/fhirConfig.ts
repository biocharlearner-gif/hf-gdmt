/**
 * Configuration for the Patient Management module.
 *
 * This module talks to the tenant FHIR server THROUGH the app's own backend-for-
 * frontend (server/index.ts), never directly. The BFF injects the Bearer token
 * server-side, so the token never reaches the browser bundle. The endpoint is
 * configuration, never hardcoded into the call sites, mirroring the convention
 * in src/fhirClient.ts.
 */

/**
 * Same-origin path to the BFF's authenticated FHIR proxy (`/api/fhir/*`). Relative
 * so calls stay same-origin: the Vite dev proxy forwards `/api` to the Bun server in
 * development (see vite.config.ts), and the app is served behind the same host in
 * production. The BFF then forwards to MEDBLOCKS_FHIR_BASE with the Bearer token.
 */
export const PATIENT_FHIR_BASE = "/api/fhir";

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

/** LOINC code system URI, for system|code-qualified Observation searches. */
export const LOINC_SYSTEM = "http://loinc.org";

/**
 * Tag that scopes the demo cohort on the shared public HAPI server. The patient
 * list filters to this tag so it shows only our seeded HF cohort and ignores the
 * unrelated data other people put on hapi.fhir.org. Set by scripts/seed-hapi.mjs.
 * (Remove this scoping once we move to a dedicated/stable server.)
 */
export const COHORT_TAG = "urn:hf-gdmt:demo|cohort-v1";

/**
 * Structured (system/code) form of COHORT_TAG. Stamped onto every Patient and
 * Condition we create from the app so they fall inside the demo cohort scope and
 * therefore show up in the tag-filtered patient list. Mirrors DEMO_TAG in
 * scripts/seed-hapi.mjs.
 */
export const DEMO_TAG = {
  system: "urn:hf-gdmt:demo",
  code: "cohort-v1",
  display: "HF GDMT demo cohort",
} as const;

/** v2-0203 "MR" (Medical Record Number) identifier type coding. */
export const MRN_TYPE = {
  system: "http://terminology.hl7.org/CodeSystem/v2-0203",
  code: "MR",
} as const;
