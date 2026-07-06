/**
 * Seed the public HAPI R4 server with a Heart-Failure demo cohort.
 *
 * WHY: the patient list is meant to be the HF *cohort* (Gate 1), not "everyone on
 * a shared public server". This seeds a controlled, tagged set we can query
 * reproducibly and re-run anytime (hapi.fhir.org is shared + periodically wiped).
 *
 * Design notes:
 *  - Every resource carries meta.tag urn:hf-gdmt:demo|cohort-v1 so our queries can
 *    scope to OUR data (`_tag=...`) and ignore whatever else lives on the server.
 *  - One transaction Bundle with `ifNoneExist` conditional-create on stable
 *    identifiers → re-running does not create duplicates (idempotent).
 *  - Conditions are coded in a MIX of SNOMED descendants of 84114007 |Heart failure|
 *    and ICD-10 I50.* — deliberately NOT all the base code, so that later the
 *    terminology-server $expand is provably doing work a single hardcoded code can't.
 *  - Includes non-HF patients and one inactive HF Condition to prove the cohort
 *    query actually excludes people (active + confirmed only).
 *
 * Run:  npm run seed            (defaults to hapi.fhir.org/baseR4)
 *       FHIR_BASE=<url> npm run seed
 *
 * Mirrors constants in src/patients/fhirConfig.ts and src/engine/codes.ts — kept
 * inline so this script has zero build/import coupling.
 */

const BASE = (process.env.FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");

const SNOMED = "http://snomed.info/sct";
const ICD10 = "http://hl7.org/fhir/sid/icd-10";
const LOINC = "http://loinc.org";
const MRN_SYSTEM = "urn:hf-gdmt:mrn";
const MRN_TYPE = { system: "http://terminology.hl7.org/CodeSystem/v2-0203", code: "MR" };
const COND_SYSTEM = "urn:hf-gdmt:cond";
const OBS_SYSTEM = "urn:hf-gdmt:obs";
const DEMO_TAG = { system: "urn:hf-gdmt:demo", code: "cohort-v1", display: "HF GDMT demo cohort" };

const CLINICAL = "http://terminology.hl7.org/CodeSystem/condition-clinical";
const VERIFICATION = "http://terminology.hl7.org/CodeSystem/condition-ver-status";

/**
 * Cohort design. `hf` flags whether this patient SHOULD land in the cohort.
 * code: { system, code, display } for the primary Condition.
 * status: clinical/verification (default active/confirmed).
 * lvef: ejection fraction % (omit → "needs echo" path later).
 */
const PEOPLE = [
  { mrn: "HF-001", first: "Eleanor", last: "Reyes", gender: "female", dob: "1948-03-12",
    hf: true, code: { system: SNOMED, code: "703272007", display: "Heart failure with reduced ejection fraction" }, lvef: 28 },
  { mrn: "HF-002", first: "Marcus", last: "Bellamy", gender: "male", dob: "1955-09-02",
    hf: true, code: { system: SNOMED, code: "417996009", display: "Systolic heart failure" }, lvef: 35 },
  { mrn: "HF-003", first: "Priya", last: "Nair", gender: "female", dob: "1962-11-25",
    hf: true, code: { system: ICD10, code: "I50.22", display: "Chronic systolic (congestive) heart failure" }, lvef: 38 },
  { mrn: "HF-004", first: "Walter", last: "Osei", gender: "male", dob: "1944-06-18",
    hf: true, code: { system: ICD10, code: "I50.9", display: "Heart failure, unspecified" } /* no LVEF → needsEf */ },
  { mrn: "HF-005", first: "Sofia", last: "Lindqvist", gender: "female", dob: "1970-01-30",
    hf: true, code: { system: SNOMED, code: "42343007", display: "Congestive heart failure" }, lvef: 46 },
  // HF code but INACTIVE → must be excluded by the cohort query
  { mrn: "HF-006", first: "Raymond", last: "Tan", gender: "male", dob: "1951-08-09",
    hf: false, code: { system: SNOMED, code: "84114007", display: "Heart failure" },
    status: { clinical: "inactive", verification: "confirmed" } },
  // Non-HF patients → must be excluded
  { mrn: "NHF-007", first: "Grace", last: "Okonkwo", gender: "female", dob: "1980-04-14",
    hf: false, code: { system: SNOMED, code: "38341003", display: "Hypertensive disorder" } },
  { mrn: "NHF-008", first: "Daniel", last: "Foster", gender: "male", dob: "1976-12-03",
    hf: false, code: { system: SNOMED, code: "73211009", display: "Diabetes mellitus" } },
];

const tagged = (resource) => ({ ...resource, meta: { ...(resource.meta || {}), tag: [DEMO_TAG] } });

function patientEntry(p, i) {
  const fullUrl = `urn:uuid:patient-${i}`;
  const resource = tagged({
    resourceType: "Patient",
    identifier: [
      { use: "usual", type: { coding: [MRN_TYPE] }, system: MRN_SYSTEM, value: p.mrn },
    ],
    name: [{ use: "official", family: p.last, given: [p.first] }],
    gender: p.gender,
    birthDate: p.dob,
  });
  return {
    fullUrl,
    resource,
    request: { method: "POST", url: "Patient", ifNoneExist: `identifier=${MRN_SYSTEM}|${p.mrn}` },
  };
}

function conditionEntry(p, i) {
  const condId = `cond-${p.mrn}`;
  const clinical = p.status?.clinical || "active";
  const verification = p.status?.verification || "confirmed";
  const resource = tagged({
    resourceType: "Condition",
    identifier: [{ system: COND_SYSTEM, value: condId }],
    clinicalStatus: { coding: [{ system: CLINICAL, code: clinical }] },
    verificationStatus: { coding: [{ system: VERIFICATION, code: verification }] },
    category: [{
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/condition-category", code: "problem-list-item" }],
    }],
    code: { coding: [{ system: p.code.system, code: p.code.code, display: p.code.display }], text: p.code.display },
    subject: { reference: `urn:uuid:patient-${i}` },
  });
  return {
    fullUrl: `urn:uuid:cond-${i}`,
    resource,
    request: { method: "POST", url: "Condition", ifNoneExist: `identifier=${COND_SYSTEM}|${condId}` },
  };
}

function lvefEntry(p, i) {
  if (typeof p.lvef !== "number") return null;
  const obsId = `lvef-${p.mrn}`;
  const resource = tagged({
    resourceType: "Observation",
    identifier: [{ system: OBS_SYSTEM, value: obsId }],
    status: "final",
    category: [{
      coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "imaging" }],
    }],
    code: { coding: [{ system: LOINC, code: "10230-1", display: "Left ventricular ejection fraction" }], text: "LVEF" },
    subject: { reference: `urn:uuid:patient-${i}` },
    effectiveDateTime: "2026-04-01",
    valueQuantity: { value: p.lvef, unit: "%", system: "http://unitsofmeasure.org", code: "%" },
  });
  return {
    fullUrl: `urn:uuid:lvef-${i}`,
    resource,
    request: { method: "POST", url: "Observation", ifNoneExist: `identifier=${OBS_SYSTEM}|${obsId}` },
  };
}

/**
 * Home-device vitals per patient as daily SERIES (oldest→newest, latest = today), so
 * the Vitals page can draw real trend charts and a reading history. The engine reads
 * the latest value of each, so the abnormal tails below still fire alerts:
 *   HF-001 → +2.6 kg/week weight gain (high) AND SpO2 declining to 88% (high)
 *   HF-002 → SBP 86 mmHg            → hypotension (moderate)
 *   HF-003 → rising weight + declining SpO2 (above floor) → predictive trend alerts (moderate)
 *   HF-004 → HR 46 bpm             → bradycardia (moderate)
 *   HF-005 → SpO2 88%              → hypoxia (high)
 * Dates are anchored to the seed run time so readings are fresh within the engine's
 * 14-day recency window.
 */
const VITALS = {
  "HF-001": { weights: [78.0, 78.4, 79.1, 79.6, 80.0, 80.3, 80.6], sbp: [116, 118, 117, 119, 118, 120, 118], hr: [74, 76, 75, 78, 77, 79, 80], spo2: [96, 95, 95, 94, 92, 90, 88] },
  "HF-002": { weights: [85.2, 85.1, 85.3, 85.0, 85.2], sbp: [92, 90, 89, 88, 86], hr: [70, 69, 68, 68, 68], spo2: [96, 96, 95, 95, 95] },
  // HF-003 → predictive trends only (no acute breach): rising weight + declining SpO2.
  "HF-003": { weights: [65.6, 65.9, 66.3, 66.6], sbp: [122, 123, 124, 124], hr: [74, 75, 76, 76], spo2: [98, 96, 95, 93] },
  "HF-004": { weights: [91.0, 91.2, 91.1], sbp: [130, 131, 132], hr: [56, 50, 46], spo2: [97, 96, 96] },
  "HF-005": { weights: [70.5, 70.6, 70.4, 70.7], sbp: [120, 119, 121, 120], hr: [78, 80, 79, 80], spo2: [95, 93, 91, 88] },
};

/**
 * Blood-pressure panel log (LOINC 85354-9) per patient: systolic + diastolic + pulse
 * components with reference ranges, a source device, and a free-text note. Drives the
 * detailed BP reading log on the Vitals page. [sys, dia, pulse, source, note].
 */
const BP_LOG = {
  "HF-001": [
    [142, 91, 72, "Omron X7", "Measured after morning walk"],
    [118, 79, 68, "Manual Entry", "Pre-sleep routine"],
    [128, 84, 75, "Omron X7", "Fasting measurement"],
    [115, 76, 64, "Omron X7", "Post meditation"],
  ],
  "HF-002": [
    [88, 58, 68, "Omron X7", "Felt lightheaded on standing"],
    [92, 61, 70, "Manual Entry", "Seated, rested 5 min"],
  ],
};

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.now();
/** ISO date `d` days before the seed run (so seeded readings are fresh). */
const daysAgo = (d) => new Date(NOW - d * DAY_MS).toISOString();

function vitalObs(p, i, suffix, loinc, display, value, unit, ucum, daysBack) {
  const obsId = `vital-${p.mrn}-${suffix}`;
  const resource = tagged({
    resourceType: "Observation",
    identifier: [{ system: OBS_SYSTEM, value: obsId }],
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
    code: { coding: [{ system: LOINC, code: loinc, display }], text: display },
    subject: { reference: `urn:uuid:patient-${i}` },
    effectiveDateTime: daysAgo(daysBack),
    valueQuantity: { value, unit, system: "http://unitsofmeasure.org", code: ucum },
  });
  return {
    fullUrl: `urn:uuid:${obsId}`,
    resource,
    request: { method: "POST", url: "Observation", ifNoneExist: `identifier=${OBS_SYSTEM}|${obsId}` },
  };
}

const UCUM = "http://unitsofmeasure.org";
function seriesObs(p, i, code, display, prefix, values, unit, ucum) {
  return values.map((value, k) =>
    vitalObs(p, i, `${prefix}-${k}`, code, display, value, unit, ucum, values.length - 1 - k),
  );
}

function bpPanelObs(p, i, k, [sys, dia, pulse, source, note]) {
  const obsId = `bp-${p.mrn}-${k}`;
  const comp = (code, display, value, unit, ucum, range) => ({
    code: { coding: [{ system: LOINC, code, display }], text: display },
    valueQuantity: { value, unit, system: UCUM, code: ucum },
    ...(range ? { referenceRange: [{ low: { value: range[0] }, high: { value: range[1] } }] } : {}),
  });
  const resource = tagged({
    resourceType: "Observation",
    identifier: [{ system: OBS_SYSTEM, value: obsId }],
    status: "final",
    category: [{ coding: [{ system: "http://terminology.hl7.org/CodeSystem/observation-category", code: "vital-signs" }] }],
    code: { coding: [{ system: LOINC, code: "85354-9", display: "Blood pressure panel" }], text: "Blood pressure" },
    subject: { reference: `urn:uuid:patient-${i}` },
    effectiveDateTime: daysAgo(k), // most recent first in the array
    device: { display: source },
    note: [{ text: note }],
    component: [
      comp("8480-6", "Systolic blood pressure", sys, "mmHg", "mm[Hg]", [sys - 4, sys + 3]),
      comp("8462-4", "Diastolic blood pressure", dia, "mmHg", "mm[Hg]", [dia - 3, dia + 3]),
      comp("8867-4", "Heart rate", pulse, "beats/minute", "/min"),
    ],
  });
  return {
    fullUrl: `urn:uuid:${obsId}`,
    resource,
    request: { method: "POST", url: "Observation", ifNoneExist: `identifier=${OBS_SYSTEM}|${obsId}` },
  };
}

function vitalEntries(p, i) {
  const v = VITALS[p.mrn];
  if (!v) return [];
  const out = [];
  out.push(...seriesObs(p, i, "29463-7", "Body weight", "wt", v.weights, "kg", "kg"));
  out.push(...seriesObs(p, i, "8480-6", "Systolic blood pressure", "sbp", v.sbp, "mmHg", "mm[Hg]"));
  out.push(...seriesObs(p, i, "8867-4", "Heart rate", "hr", v.hr, "beats/minute", "/min"));
  out.push(...seriesObs(p, i, "59408-5", "Oxygen saturation", "spo2", v.spo2, "%", "%"));
  (BP_LOG[p.mrn] ?? []).forEach((reading, k) => out.push(bpPanelObs(p, i, k, reading)));
  return out;
}

/**
 * Curated alert-derived Tasks so the Tasks page has a clean, varied demo set across
 * the FHIR workflow. Each links (focus) to the latest Observation of its vital, is
 * owned by the accepting clinician, and carries the alert note (+ an action note for
 * started/completed tasks). [vital, title, status, note, actionNote?, reason?].
 */
const TASKS = {
  "HF-002": { vital: "bloodPressure", prefix: "sbp", severity: "moderate",
    title: "Low blood pressure — titration-limiting", status: "accepted",
    note: "Systolic BP 86 mmHg is below 90 mmHg. May limit ARNI/ACEi/ARB & SGLT2i up-titration." },
  "HF-004": { vital: "heartRate", prefix: "hr", severity: "moderate",
    title: "Bradycardia — beta-blocker-limiting", status: "in-progress",
    note: "Heart rate 46 bpm is below 50 bpm, which limits beta-blocker up-titration.",
    actionNote: "Held bisoprolol dose; ordered 12-lead ECG and repeat HR in 24h." },
  "HF-005": { vital: "spo2", prefix: "spo2", severity: "high",
    title: "Low oxygen saturation", status: "completed",
    note: "SpO₂ 88% is below 90%.",
    actionNote: "Advised supplemental O2 and clinic review; SpO2 recovered to 94%." },
  "HF-003": { vital: "weight", prefix: "wt", severity: "moderate",
    title: "Upward weight trend — watch for fluid retention", status: "cancelled",
    note: "Weight rising over consecutive readings, below the acute 2.3 kg threshold.",
    reason: "Weight stabilized on recheck; no intervention needed." },
};

function taskEntry(p, i) {
  const t = TASKS[p.mrn];
  const v = VITALS[p.mrn];
  if (!t || !v) return null;
  const series = v[t.prefix === "wt" ? "weights" : t.prefix];
  const latestIdx = (series?.length ?? 1) - 1;
  const priority = t.severity === "high" ? "urgent" : t.severity === "moderate" ? "asap" : "routine";
  const note = [{ text: `${t.note} (Source: HF remote-monitoring)` }];
  if (t.actionNote) note.push({ text: t.actionNote, authorString: "Dr. Smith", time: daysAgo(0) });
  const resource = tagged({
    resourceType: "Task",
    identifier: [{ system: "urn:hf-gdmt:task", value: `seed-${p.mrn}-${t.vital}` }],
    status: t.status,
    intent: "order",
    priority,
    description: `Review HF alert: ${t.title}`,
    code: { text: `HF remote-monitoring alert: ${t.vital}` },
    for: { reference: `urn:uuid:patient-${i}` },
    focus: { reference: `urn:uuid:vital-${p.mrn}-${t.prefix}-${latestIdx}` },
    owner: { display: "Dr. Smith" },
    authoredOn: daysAgo(1),
    ...(t.reason ? { statusReason: { text: t.reason } } : {}),
    note,
  });
  return {
    fullUrl: `urn:uuid:task-${p.mrn}`,
    resource,
    request: { method: "POST", url: "Task", ifNoneExist: `identifier=urn:hf-gdmt:task|seed-${p.mrn}-${t.vital}` },
  };
}

function buildBundle() {
  const entry = [];
  PEOPLE.forEach((p, i) => {
    entry.push(patientEntry(p, i));
    entry.push(conditionEntry(p, i));
    const lvef = lvefEntry(p, i);
    if (lvef) entry.push(lvef);
    entry.push(...vitalEntries(p, i));
    const task = taskEntry(p, i);
    if (task) entry.push(task);
  });
  return { resourceType: "Bundle", type: "transaction", entry };
}

async function main() {
  const bundle = buildBundle();
  const hfCount = PEOPLE.filter((p) => p.hf).length;
  console.log(`Seeding ${PEOPLE.length} patients (${hfCount} active+confirmed HF) → ${BASE}`);

  const res = await fetch(`${BASE}`, {
    method: "POST",
    headers: { "Content-Type": "application/fhir+json", Accept: "application/fhir+json" },
    body: JSON.stringify(bundle),
  });

  if (!res.ok) {
    console.error(`Transaction failed: ${res.status}`);
    console.error(await res.text());
    process.exit(1);
  }

  const out = await res.json();
  const statuses = (out.entry || []).map((e) => e.response?.status || "?");
  const created = statuses.filter((s) => String(s).startsWith("201")).length;
  const existing = statuses.filter((s) => String(s).startsWith("200")).length;
  console.log(`Done. created=${created} alreadyPresent=${existing} total=${statuses.length}`);
  console.log(`Tag: ${DEMO_TAG.system}|${DEMO_TAG.code}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
