import { describe, it, expect } from "vitest";
import { buildEngineInput, buildHospitalizationSignal } from "./extract";
import { evaluateGdmt } from "../engine/engine";

const NOW = "2026-06-16T00:00:00.000Z";
const RECENT = "2026-05-20T00:00:00.000Z";

/** A MedicationRequest/MedicationStatement for a known beta-blocker at target dose. */
function med(status: string, resourceType = "MedicationRequest") {
  return {
    resourceType,
    id: `med-${status}`,
    status,
    medicationCodeableConcept: {
      text: "carvedilol",
      coding: [{ system: "http://www.nlm.nih.gov/research/umls/rxnorm", code: "20352", display: "carvedilol" }],
    },
    dosageInstruction: [
      {
        doseAndRate: [{ doseQuantity: { value: 25, unit: "mg" } }],
        timing: { repeat: { frequency: 2, period: 1 } },
      },
    ],
  };
}

function obs(code: string, value: number, unit = "%") {
  return {
    resourceType: "Observation",
    code: { coding: [{ system: "http://loinc.org", code }] },
    effectiveDateTime: RECENT,
    valueQuantity: { value, unit },
  };
}

/**
 * An HFrEF patient (LVEF 30%) with labs and vitals that gate nothing, so a pillar's
 * status is driven purely by the medications passed in.
 */
function inputWith(medications: object[]) {
  return buildEngineInput({
    patientId: "p1",
    now: NOW,
    observations: [
      obs("10230-1", 30), // LVEF 30% -> HFrEF
      obs("2823-3", 4.2, "mmol/L"), // potassium
      obs("33914-3", 60, "mL/min/1.73m2"), // eGFR
      obs("8480-6", 120, "mm[Hg]"), // systolic BP
      obs("8867-4", 72, "/min"), // heart rate
    ],
    medications: medications as never,
  });
}

/** The `active` flag for the sole medication in the extracted input. */
function activeFlag(status: string, resourceType?: string): boolean {
  const input = inputWith([med(status, resourceType)]);
  expect(input.medications).toHaveLength(1);
  return input.medications[0]!.active;
}

describe("buildEngineInput — medication activity", () => {
  it("counts active and on-hold as currently on therapy", () => {
    // on-hold is a temporary suspension of an established prescription; the patient
    // is still on the pillar, so we must not recommend starting the drug.
    for (const status of ["active", "on-hold"]) {
      expect(activeFlag(status)).toBe(true);
    }
  });

  it("does not count completed or intended as on therapy", () => {
    // Regression: these previously counted as active and silently closed a pillar gap.
    // `completed` = the course finished; `intended` = planned but never taken.
    expect(activeFlag("completed")).toBe(false);
    expect(activeFlag("intended", "MedicationStatement")).toBe(false);
  });

  it("does not count any remaining MedicationRequest status as on therapy", () => {
    for (const status of ["cancelled", "entered-in-error", "stopped", "draft", "unknown"]) {
      expect(activeFlag(status)).toBe(false);
    }
  });

  it("does not count any remaining MedicationStatement status as on therapy", () => {
    for (const status of ["completed", "entered-in-error", "stopped", "not-taken", "unknown"]) {
      expect(activeFlag(status, "MedicationStatement")).toBe(false);
    }
  });

  it("treats an unrecognised status as not on therapy", () => {
    // Opposite default from the UI's medicationActivity: a false "on therapy" silently
    // closes a real gap, so anything we do not affirmatively recognise must not count.
    expect(activeFlag("bogus-code")).toBe(false);
    expect(activeFlag("")).toBe(false);
  });

  it("is case-sensitive per the FHIR R4 required binding", () => {
    // Status codes are a required binding; "Active" is not a conformant value.
    expect(activeFlag("Active")).toBe(false);
  });

  it("defaults a status-less resource to active", () => {
    // status is 1..1 in R4, so this is malformed data; tolerate it rather than crash.
    const input = inputWith([{ resourceType: "MedicationRequest", id: "no-status" }]);
    expect(input.medications[0]!.active).toBe(true);
  });

  it("threads MedicationRequest.authoredOn onto the fact as startedOn", () => {
    const input = inputWith([{ ...med("active"), authoredOn: RECENT }]);
    expect(input.medications[0]!.startedOn).toBe(RECENT);
    // Missing authoredOn leaves startedOn undefined (no start date to reason about).
    const noDate = inputWith([med("active")]);
    expect(noDate.medications[0]!.startedOn).toBeUndefined();
  });
});

describe("buildHospitalizationSignal", () => {
  const NOW2 = "2026-06-16T00:00:00.000Z";
  const daysBefore = (n: number) => new Date(new Date(NOW2).getTime() - n * 86_400_000).toISOString();
  const hfInpatient = (dischargeDaysAgo: number) => ({
    resourceType: "Encounter",
    status: "finished",
    class: { code: "IMP" },
    reasonCode: [{ coding: [{ system: "http://snomed.info/sct", code: "42343007", display: "Congestive heart failure" }] }],
    period: { start: daysBefore(dischargeDaysAgo + 4), end: daysBefore(dischargeDaysAgo) },
  });

  it("returns the most recent HF inpatient stay with days since discharge", () => {
    const s = buildHospitalizationSignal({ now: NOW2, encounters: [hfInpatient(40), hfInpatient(10)] });
    expect(s?.daysSinceDischarge).toBe(10);
  });

  it("ignores non-HF and outpatient encounters", () => {
    const outpatient = { resourceType: "Encounter", class: { code: "AMB" }, reasonCode: [{ text: "Heart failure" }], period: { end: daysBefore(5) } };
    const nonHf = { resourceType: "Encounter", class: { code: "IMP" }, reasonCode: [{ coding: [{ code: "44054006", display: "Diabetes" }] }], period: { end: daysBefore(5) } };
    expect(buildHospitalizationSignal({ now: NOW2, encounters: [outpatient, nonHf] })).toBeUndefined();
  });

  it("returns undefined when there are no encounters", () => {
    expect(buildHospitalizationSignal({ now: NOW2, encounters: [] })).toBeUndefined();
  });
});

describe("evaluateGdmt — a non-current prescription must not close a pillar gap", () => {
  it("reports a beta-blocker gap for a patient whose only beta-blocker is completed", () => {
    const a = evaluateGdmt(inputWith([med("completed")]));
    const bb = a.pillars.find((p) => p.id === "BetaBlocker")!;
    expect(bb.status).toBe("GAP_ELIGIBLE");
  });

  it("still credits the pillar when the beta-blocker is active", () => {
    const a = evaluateGdmt(inputWith([med("active")]));
    const bb = a.pillars.find((p) => p.id === "BetaBlocker")!;
    expect(bb.status).toBe("ON_TARGET");
  });

  it("credits an on-hold beta-blocker rather than recommending a restart", () => {
    const a = evaluateGdmt(inputWith([med("on-hold")]));
    const bb = a.pillars.find((p) => p.id === "BetaBlocker")!;
    expect(bb.status).toBe("ON_TARGET");
  });
});
