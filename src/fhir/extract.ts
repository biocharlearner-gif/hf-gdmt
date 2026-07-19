import type { Dated, EngineInput, MedicationFact } from "../engine/types";
import type { AlertInput, VitalReading } from "../engine/alerts";
import type { HospitalizationSignal } from "../engine/risk";
import { LOINC, SNOMED, classifyMed } from "../engine/codes";

/* Minimal FHIR typings — enough for extraction without pulling a full FHIR package. */
interface Coding { system?: string; code?: string; display?: string }
interface CodeableConcept { coding?: Coding[]; text?: string }
interface Quantity { value?: number; unit?: string }
interface FhirResource { resourceType: string; [k: string]: unknown }
type Bundle = { entry?: { resource?: FhirResource }[] };

function codesOf(cc?: CodeableConcept): string[] {
  return (cc?.coding ?? []).map((c) => c.code ?? "").filter(Boolean);
}
function hasLoinc(obs: any, set: readonly string[]): boolean {
  return codesOf(obs.code).some((c) => set.includes(c));
}
function obsValue(obs: any): number | undefined {
  const q: Quantity | undefined = obs.valueQuantity;
  return typeof q?.value === "number" ? q.value : undefined;
}
function obsDate(obs: any): string | undefined {
  return obs.effectiveDateTime ?? obs.effectiveInstant ?? obs.issued ?? undefined;
}
function dated(value: number | undefined, date?: string): Dated<number> | undefined {
  return value === undefined ? undefined : { value, date };
}

function resources(bundleOrArray: Bundle | FhirResource[]): FhirResource[] {
  if (Array.isArray(bundleOrArray)) return bundleOrArray;
  return (bundleOrArray.entry ?? []).map((e) => e.resource).filter(Boolean) as FhirResource[];
}

/** Parse a daily dose (mg) from a MedicationRequest dosageInstruction, best-effort. */
function parseDailyDoseMg(mr: any): number | undefined {
  const di = mr.dosageInstruction?.[0];
  const dose = di?.doseAndRate?.[0]?.doseQuantity;
  const perDay = di?.timing?.repeat?.frequency && di?.timing?.repeat?.period === 1
    ? di.timing.repeat.frequency
    : 1;
  if (typeof dose?.value === "number" && (dose.unit ?? "").toLowerCase().includes("mg")) {
    return dose.value * perDay;
  }
  return undefined;
}

/**
 * Statuses that mean "the patient is taking this drug right now", across both
 * MedicationRequest.status and MedicationStatement.status (R4).
 *
 * Only `active` and `on-hold` qualify. `on-hold` is a temporary suspension of an
 * established prescription, so it still counts as being on the pillar — recommending
 * a start for a drug that is merely held (e.g. for transient hyperkalemia) would be
 * wrong. Everything else means not-on-therapy, notably:
 *   - `completed`  — the course finished; for chronic GDMT that is the opposite of on-therapy
 *   - `intended`   — MedicationStatement: planned, not yet taken
 *   - `draft`      — MedicationRequest: prescription not yet issued
 *   - `stopped` / `cancelled` / `not-taken` / `entered-in-error` / `unknown`
 *
 * This is deliberately NOT the same predicate as `medicationActivity` in
 * `src/patients/clinicalData.ts`, and the two must not be merged. That one drives a
 * display filter, where an unrecognised status falls back to *active* so a row is never
 * silently hidden. Here an unrecognised status must fall back to *not* on therapy: a
 * false "on therapy" silently closes a real GDMT gap, which is the failure mode this
 * engine exists to prevent. Same word, opposite safe default.
 */
function isOnTherapy(status: string): boolean {
  return status === "active" || status === "on-hold";
}

/**
 * Build EngineInput from FHIR resources. Accepts either FHIR Bundles or flat
 * resource arrays for Patient/Condition/Observation/MedicationRequest/AllergyIntolerance.
 * `now` is injected so the engine stays deterministic.
 */
export function buildEngineInput(opts: {
  patientId: string;
  now?: string;
  observations: Bundle | FhirResource[];
  medications: Bundle | FhirResource[];
  conditions?: Bundle | FhirResource[];
  allergies?: Bundle | FhirResource[];
}): EngineInput {
  const obs = resources(opts.observations).filter((r) => r.resourceType === "Observation");
  const meds = resources(opts.medications).filter(
    (r) => r.resourceType === "MedicationRequest" || r.resourceType === "MedicationStatement",
  );
  const allergies = resources(opts.allergies ?? []).filter((r) => r.resourceType === "AllergyIntolerance");

  const latest = (set: readonly string[]) =>
    obs.filter((o) => hasLoinc(o, set))
       .sort((a, b) => (obsDate(b) ?? "").localeCompare(obsDate(a) ?? ""))[0];

  const lvefObs = latest(LOINC.LVEF);
  const kObs = latest(LOINC.POTASSIUM);
  const egfrObs = latest(LOINC.EGFR);
  const crObs = latest(LOINC.CREATININE);
  const sbpObs = latest(LOINC.SBP);
  const hrObs = latest(LOINC.HEART_RATE);

  const medications: MedicationFact[] = meds.map((m: any) => {
    const name =
      m.medicationCodeableConcept?.text ??
      m.medicationCodeableConcept?.coding?.[0]?.display ??
      "unknown";
    const rxnorm = (m.medicationCodeableConcept?.coding ?? []).find(
      (c: Coding) => (c.system ?? "").includes("rxnorm"),
    )?.code;
    const status = m.status ?? "active";
    return {
      name,
      rxnorm,
      pillar: classifyMed(name),
      dailyDoseMg: parseDailyDoseMg(m),
      active: isOnTherapy(status),
      startedOn: typeof m.authoredOn === "string" ? m.authoredOn : undefined,
    };
  });

  const angioedemaHistory = allergies.some((a: any) =>
    JSON.stringify(a).toLowerCase().includes("angioedema"),
  );

  return {
    patientId: opts.patientId,
    now: opts.now ?? new Date().toISOString(),
    lvef: dated(lvefObs ? obsValue(lvefObs) : undefined, lvefObs ? obsDate(lvefObs) : undefined),
    medications,
    labs: {
      potassium: dated(kObs ? obsValue(kObs) : undefined, kObs ? obsDate(kObs) : undefined),
      egfr: dated(egfrObs ? obsValue(egfrObs) : undefined, egfrObs ? obsDate(egfrObs) : undefined),
      creatinine: dated(crObs ? obsValue(crObs) : undefined, crObs ? obsDate(crObs) : undefined),
    },
    vitals: {
      systolicBp: dated(sbpObs ? obsValue(sbpObs) : undefined, sbpObs ? obsDate(sbpObs) : undefined),
      heartRate: dated(hrObs ? obsValue(hrObs) : undefined, hrObs ? obsDate(hrObs) : undefined),
    },
    flags: { angioedemaHistory },
  };
}

/** Convert a weight Observation to kg, honoring lb units. */
function weightKg(obs: any): number | undefined {
  const q: Quantity | undefined = obs.valueQuantity;
  if (typeof q?.value !== "number") return undefined;
  const unit = (q.unit ?? "").toLowerCase();
  if (unit.includes("lb") || unit === "[lb_av]") return q.value * 0.453592;
  return q.value; // assume kg (or unitless → treat as kg)
}

/**
 * Build AlertInput for the remote-monitoring alert engine from FHIR Observations.
 * Produces a chronological home-weight series (kg) plus the latest BP / HR / SpO2.
 * Recency filtering lives in the pure engine, so we pass values with their dates and
 * do not drop anything here. `now` is injected to keep the engine deterministic.
 */
export function buildAlertInput(opts: {
  patientId: string;
  now?: string;
  observations: Bundle | FhirResource[];
}): AlertInput {
  const obs = resources(opts.observations).filter((r) => r.resourceType === "Observation");

  const weightSeriesKg: VitalReading[] = obs
    .filter((o) => hasLoinc(o, LOINC.BODY_WEIGHT))
    .map((o) => ({ value: weightKg(o), date: obsDate(o) }))
    .filter((r): r is VitalReading => typeof r.value === "number" && typeof r.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date));

  const latest = (set: readonly string[]) =>
    obs.filter((o) => hasLoinc(o, set))
       .sort((a, b) => (obsDate(b) ?? "").localeCompare(obsDate(a) ?? ""))[0];

  const sbpObs = latest(LOINC.SBP);
  const hrObs = latest(LOINC.HEART_RATE);
  const spo2Obs = latest(LOINC.SPO2);

  const spo2SeriesPct: VitalReading[] = obs
    .filter((o) => hasLoinc(o, LOINC.SPO2))
    .map((o) => ({ value: obsValue(o), date: obsDate(o) }))
    .filter((r): r is VitalReading => typeof r.value === "number" && typeof r.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date));

  return {
    patientId: opts.patientId,
    now: opts.now ?? new Date().toISOString(),
    weightSeriesKg,
    systolicBp: dated(sbpObs ? obsValue(sbpObs) : undefined, sbpObs ? obsDate(sbpObs) : undefined),
    heartRate: dated(hrObs ? obsValue(hrObs) : undefined, hrObs ? obsDate(hrObs) : undefined),
    spo2: dated(spo2Obs ? obsValue(spo2Obs) : undefined, spo2Obs ? obsDate(spo2Obs) : undefined),
    spo2SeriesPct,
  };
}

/** SNOMED codes that mark an Encounter as heart-failure-related (HF + common variants). */
const HF_ENCOUNTER_SNOMED = new Set([
  SNOMED.HEART_FAILURE, SNOMED.HFREF,
  "42343007",  // Congestive heart failure
  "88805009",  // Chronic congestive heart failure
  "56675007",  // Acute heart failure
]);

/** R4 Encounter.class inpatient/acute codes (v3 ActCode). */
const INPATIENT_CLASS = new Set(["IMP", "ACUTE", "NONAC"]);

function isInpatient(enc: any): boolean {
  const code = enc.class?.code ?? enc.class?.coding?.[0]?.code;
  return typeof code === "string" && INPATIENT_CLASS.has(code);
}

function isHfEncounter(enc: any): boolean {
  const ccs: CodeableConcept[] = [...(enc.reasonCode ?? []), ...(enc.type ?? [])];
  for (const cc of ccs) {
    for (const c of cc.coding ?? []) {
      if (c.code && HF_ENCOUNTER_SNOMED.has(c.code)) return true;
      if ((c.code ?? "").toUpperCase().startsWith("I50")) return true; // ICD-10 HF family
      if (/heart failure/i.test(c.display ?? "")) return true;
    }
    if (/heart failure/i.test(cc.text ?? "")) return true;
  }
  return false;
}

/**
 * Most recent HF-related inpatient stay as a risk signal, or undefined if none.
 * Discharge date = Encounter.period.end (falls back to start for an ongoing stay).
 * `now` is injected to keep the derived day-count deterministic.
 */
export function buildHospitalizationSignal(opts: {
  now?: string;
  encounters: Bundle | FhirResource[];
}): HospitalizationSignal | undefined {
  const now = opts.now ?? new Date().toISOString();
  const hf = resources(opts.encounters)
    .filter((r) => r.resourceType === "Encounter")
    .filter((e: any) => isInpatient(e) && isHfEncounter(e))
    .map((e: any) => ({ when: e.period?.end ?? e.period?.start }))
    .filter((x): x is { when: string } => typeof x.when === "string")
    .sort((a, b) => b.when.localeCompare(a.when));

  const latest = hf[0];
  if (!latest) return undefined;
  const days = Math.max(0, Math.floor((Date.parse(now) - Date.parse(latest.when)) / (24 * 60 * 60 * 1000)));
  return { daysSinceDischarge: days, when: latest.when };
}

export { SNOMED };
