import { describe, expect, it } from "vitest";
import {
  conditionActivity,
  medicationActivity,
  summarizeCondition,
  summarizeMedication,
} from "./clinicalData";
import { buildLabSeries, flagFor, fmtLabValue, LAB_PANEL } from "./labs";
import type { FhirResource } from "./patientApi";

const CLINICAL = "http://terminology.hl7.org/CodeSystem/condition-clinical";

function condition(clinicalStatus: string): FhirResource {
  return {
    resourceType: "Condition",
    id: `cond-${clinicalStatus}`,
    clinicalStatus: { coding: [{ system: CLINICAL, code: clinicalStatus }] },
    code: { coding: [{ system: "http://snomed.info/sct", code: "38341003", display: "Hypertensive disorder" }] },
  };
}

function medication(status: string): FhirResource {
  return {
    resourceType: "MedicationRequest",
    id: `med-${status}`,
    status,
    medicationCodeableConcept: { text: "Carvedilol" },
  };
}

/** A lab Observation with the given LOINC code, value and date. */
function labObs(code: string, value: number | undefined, date: string): FhirResource {
  return {
    resourceType: "Observation",
    code: { coding: [{ system: "http://loinc.org", code }] },
    effectiveDateTime: date,
    ...(value === undefined ? {} : { valueQuantity: { value, unit: "mmol/L" } }),
  };
}

const POTASSIUM = "2823-3";
const EGFR = "33914-3";

function seriesFor(key: string, resources: FhirResource[]) {
  const s = buildLabSeries(resources).find((x) => x.def.key === key);
  if (!s) throw new Error(`no series for ${key}`);
  return s;
}

describe("conditionActivity", () => {
  it("treats active, recurrence and relapse as active problems", () => {
    for (const s of ["active", "recurrence", "relapse"]) {
      expect(conditionActivity(s)).toBe("active");
    }
  });

  it("treats inactive, remission and resolved as resolved", () => {
    for (const s of ["inactive", "remission", "resolved"]) {
      expect(conditionActivity(s)).toBe("resolved");
    }
  });

  it("falls back to active for a missing or unrecognised status", () => {
    // Degrade gracefully: a filter must never silently hide a problem.
    expect(conditionActivity(undefined)).toBe("active");
    expect(conditionActivity("")).toBe("active");
    expect(conditionActivity("bogus-code")).toBe("active");
  });

  it("is case-insensitive", () => {
    expect(conditionActivity("Resolved")).toBe("resolved");
  });
});

describe("medicationActivity", () => {
  it("treats active, on-hold and draft as active", () => {
    for (const s of ["active", "on-hold", "draft"]) {
      expect(medicationActivity(s)).toBe("active");
    }
  });

  it("treats discontinued statuses as resolved", () => {
    for (const s of ["stopped", "completed", "cancelled", "ended", "entered-in-error"]) {
      expect(medicationActivity(s)).toBe("resolved");
    }
  });

  it("falls back to active for a missing or unrecognised status", () => {
    expect(medicationActivity(undefined)).toBe("active");
    expect(medicationActivity("unknown")).toBe("active");
  });
});

describe("summarizers carry the toggle side", () => {
  it("marks a resolved condition resolved and keeps the raw status for display", () => {
    const s = summarizeCondition(condition("resolved"));
    expect(s.activity).toBe("resolved");
    expect(s.clinicalStatus).toBe("resolved");
    expect(s.display).toBe("Hypertensive disorder");
  });

  it("marks a stopped med resolved and surfaces its statusReason", () => {
    const s = summarizeMedication({
      ...medication("stopped"),
      statusReason: { text: "Discontinued — persistent cough" },
    });
    expect(s.activity).toBe("resolved");
    expect(s.statusReason).toBe("Discontinued — persistent cough");
    expect(s.pillar).toBe("BetaBlocker");
  });

  it("marks an active med active", () => {
    expect(summarizeMedication(medication("active")).activity).toBe("active");
  });
});

describe("flagFor", () => {
  const potassium = LAB_PANEL.find((d) => d.key === "potassium")!;
  const egfr = LAB_PANEL.find((d) => d.key === "egfr")!;

  it("flags values outside the reference range", () => {
    expect(flagFor(potassium, 5.4)).toBe("high");
    expect(flagFor(potassium, 3.1)).toBe("low");
    expect(flagFor(potassium, 4.2)).toBe("normal");
  });

  it("only applies the bounds a def actually declares", () => {
    // eGFR has a low bound but no high bound — a very high eGFR is not "abnormal" here.
    expect(flagFor(egfr, 45)).toBe("low");
    expect(flagFor(egfr, 200)).toBe("normal");
  });
});

describe("fmtLabValue", () => {
  const def = (key: string) => LAB_PANEL.find((d) => d.key === key)!;

  it("keeps trailing zeros that carry clinical meaning", () => {
    // "1" would misreport the precision the creatinine assay actually reports to.
    expect(fmtLabValue(def("creatinine"), 1)).toBe("1.00");
    expect(fmtLabValue(def("potassium"), 4)).toBe("4.0");
  });

  it("reports each analyte at its own precision", () => {
    expect(fmtLabValue(def("egfr"), 67.8)).toBe("68");
    expect(fmtLabValue(def("ntprobnp"), 2400)).toBe("2400");
    expect(fmtLabValue(def("potassium"), 5.24)).toBe("5.2");
  });
});

describe("buildLabSeries", () => {
  it("groups by LOINC and returns each series oldest-first", () => {
    const s = seriesFor("potassium", [
      labObs(POTASSIUM, 5.2, "2026-07-01"),
      labObs(POTASSIUM, 4.1, "2026-01-01"),
      labObs(POTASSIUM, 4.8, "2026-04-01"),
      labObs(EGFR, 58, "2026-07-01"),
    ]);
    expect(s.points.map((p) => p.value)).toEqual([4.1, 4.8, 5.2]);
    expect(s.latest?.value).toBe(5.2);
  });

  it("computes the delta from the previous point to the latest", () => {
    const s = seriesFor("potassium", [
      labObs(POTASSIUM, 4.0, "2026-01-01"),
      labObs(POTASSIUM, 5.0, "2026-07-01"),
    ]);
    expect(s.deltaPct).toBeCloseTo(25);
  });

  it("has no delta with a single point", () => {
    const s = seriesFor("potassium", [labObs(POTASSIUM, 4.0, "2026-01-01")]);
    expect(s.deltaPct).toBeNull();
  });

  it("flags each point against the reference range", () => {
    const s = seriesFor("potassium", [
      labObs(POTASSIUM, 3.0, "2026-01-01"),
      labObs(POTASSIUM, 4.2, "2026-04-01"),
      labObs(POTASSIUM, 5.4, "2026-07-01"),
    ]);
    expect(s.points.map((p) => p.flag)).toEqual(["low", "normal", "high"]);
  });

  it("returns every panel analyte, including ones with no results", () => {
    const all = buildLabSeries([labObs(POTASSIUM, 4.2, "2026-07-01")]);
    expect(all).toHaveLength(LAB_PANEL.length);
    // "No potassium on file" is itself GDMT-relevant, so empty analytes must not vanish.
    const bnp = all.find((s) => s.def.key === "bnp");
    expect(bnp?.points).toEqual([]);
    expect(bnp?.latest).toBeUndefined();
  });

  it("ignores observations outside the panel", () => {
    const s = seriesFor("potassium", [
      labObs("8867-4", 72, "2026-07-01"), // heart rate
      labObs(POTASSIUM, 4.2, "2026-07-01"),
    ]);
    expect(s.points).toHaveLength(1);
  });

  it("ignores non-Observation resources", () => {
    const s = seriesFor("potassium", [
      { resourceType: "MedicationRequest", id: "m1" },
      labObs(POTASSIUM, 4.2, "2026-07-01"),
    ]);
    expect(s.points).toHaveLength(1);
  });

  it("skips results with no numeric value rather than throwing", () => {
    const s = seriesFor("potassium", [
      labObs(POTASSIUM, undefined, "2026-01-01"),
      labObs(POTASSIUM, 4.2, "2026-07-01"),
    ]);
    expect(s.points.map((p) => p.value)).toEqual([4.2]);
  });

  it("skips results with no date", () => {
    const s = seriesFor("potassium", [
      { resourceType: "Observation", code: { coding: [{ code: POTASSIUM }] }, valueQuantity: { value: 4.2 } },
    ]);
    expect(s.points).toEqual([]);
  });

  it("falls back to issued when effectiveDateTime is absent", () => {
    const s = seriesFor("potassium", [
      {
        resourceType: "Observation",
        code: { coding: [{ code: POTASSIUM }] },
        valueQuantity: { value: 4.2 },
        issued: "2026-07-01",
      },
    ]);
    expect(s.latest?.date).toBe("2026-07-01");
  });

  it("copes with an empty input", () => {
    expect(seriesFor("potassium", []).points).toEqual([]);
  });
});
