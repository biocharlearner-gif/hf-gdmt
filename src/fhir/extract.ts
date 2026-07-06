import type { Dated, EngineInput, MedicationFact } from "../engine/types";
import type { AlertInput, VitalReading } from "../engine/alerts";
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
      active: ["active", "completed", "intended", "on-hold"].includes(status) && status !== "stopped",
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

export { SNOMED };
