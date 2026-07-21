/**
 * Seeds a self-contained HFrEF demo patient onto public HAPI R4 (CORS-open) for the
 * CDS Hooks Sandbox demo — see docs/CDS-DEMO.md. Public HAPI is CORS-open + R4 so the
 * sandbox can prefetch it client-side (our own /api/fhir proxy deliberately isn't CORS-open).
 * All values (LVEF 28, K+ 4.2, eGFR 68, HR 72, SBP 118, no GDMT meds) make the engine
 * return all four pillars GAP_ELIGIBLE, so the patient-view card fires strongly.
 *
 * Run: node scripts/seed-cds-demo.mjs   (plain node, no env needed — targets public HAPI)
 * Public HAPI purges old data; re-run if Patient/137203927 no longer exists.
 */
const HAPI = "https://hapi.fhir.org/baseR4";
const today = new Date().toISOString().slice(0, 10);
const eff = new Date().toISOString();
const pUuid = "urn:uuid:patient-cds-demo";
const TAG = { system: "urn:hf-gdmt:demo", code: "cds-hooks-v1" };

const obs = (loinc, display, value, unit, category = "laboratory") => ({
  fullUrl: `urn:uuid:obs-${loinc}`,
  resource: {
    resourceType: "Observation", status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: category }] }],
    code: { coding: [{ system: "http://loinc.org", code: loinc, display }], text: display },
    subject: { reference: pUuid }, effectiveDateTime: eff,
    valueQuantity: { value, unit, system: "http://unitsofmeasure.org" },
    meta: { tag: [TAG] },
  },
  request: { method: "POST", url: "Observation" },
});

const bundle = {
  resourceType: "Bundle", type: "transaction",
  entry: [
    { fullUrl: pUuid, resource: {
        resourceType: "Patient", meta: { tag: [TAG] },
        name: [{ use: "official", family: "Whitmore", given: ["Harold", "J."] }],
        gender: "male", birthDate: "1951-04-08",
        identifier: [{ system: "urn:hf-gdmt:mrn", value: "CDS-DEMO-001" }],
      }, request: { method: "POST", url: "Patient" } },
    { fullUrl: "urn:uuid:cond-hf", resource: {
        resourceType: "Condition", meta: { tag: [TAG] },
        clinicalStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-clinical", code: "active" }] },
        verificationStatus: { coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-ver-status", code: "confirmed" }] },
        category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "problem-list-item" }] }],
        code: { coding: [
          { system: "http://snomed.info/sct", code: "84114007", display: "Heart failure" },
          { system: "http://hl7.org/fhir/sid/icd-10-cm", code: "I50.9", display: "Heart failure, unspecified" },
        ], text: "Heart failure with reduced ejection fraction" },
        subject: { reference: pUuid }, recordedDate: today,
      }, request: { method: "POST", url: "Condition" } },
    obs("10230-1", "Left ventricular ejection fraction", 28, "%", "imaging"),
    obs("2823-3", "Potassium [Moles/volume] in Serum or Plasma", 4.2, "mmol/L"),
    obs("33914-3", "eGFR", 68, "mL/min/1.73m2"),
    obs("8867-4", "Heart rate", 72, "/min", "vital-signs"),
    obs("8480-6", "Systolic blood pressure", 118, "mm[Hg]", "vital-signs"),
  ],
};

const res = await fetch(HAPI, {
  method: "POST",
  headers: { "Content-Type": "application/fhir+json", Accept: "application/fhir+json" },
  body: JSON.stringify(bundle),
});
const out = await res.json();
console.log("status", res.status);
const pid = (out.entry || []).map(e => e.response && e.response.location).find(l => l && l.startsWith("Patient/"));
console.log("Patient location:", pid);
(out.entry || []).forEach(e => console.log(" ", e.response && e.response.status, e.response && e.response.location));
