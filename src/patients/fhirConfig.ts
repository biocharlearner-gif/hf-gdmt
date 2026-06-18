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

/** Identifier system under which we store the Medical Record Number. */
export const MRN_SYSTEM = "urn:hf-gdmt:mrn";

/** v2-0203 "MR" (Medical Record Number) identifier type coding. */
export const MRN_TYPE = {
  system: "http://terminology.hl7.org/CodeSystem/v2-0203",
  code: "MR",
} as const;
