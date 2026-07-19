import { describe, it, expect } from "vitest";
import { riskFromObservations } from "./patientRisk";
import type { FhirResource } from "./patientApi";

/**
 * riskFromObservations composes the real (pure) alert engine + risk roll-up from raw
 * FHIR Observations. These fixtures verify the end-to-end mapping without any network.
 */
const NOW = "2026-06-16T00:00:00.000Z";
const daysAgo = (n: number): string => new Date(new Date(NOW).getTime() - n * 86_400_000).toISOString();

/** Minimal FHIR Observation with a single LOINC coding + numeric value. */
function obs(loinc: string, value: number, date: string, unit = "kg"): FhirResource {
  return {
    resourceType: "Observation",
    code: { coding: [{ system: "http://loinc.org", code: loinc }] },
    valueQuantity: { value, unit },
    effectiveDateTime: date,
  };
}

const LOINC_WEIGHT = "29463-7";
const LOINC_SBP = "8480-6";

describe("riskFromObservations", () => {
  it("scores an empty history as Stable (0)", () => {
    const r = riskFromObservations("p1", [], NOW);
    expect(r.score).toBe(0);
    expect(r.band).toBe("Stable");
  });

  it("lands in the High band on a single high-severity alert (rapid 7-day weight gain)", () => {
    const observations = [
      obs(LOINC_WEIGHT, 80, daysAgo(7)),
      obs(LOINC_WEIGHT, 83, daysAgo(0)),
    ];
    const r = riskFromObservations("p1", observations, NOW);
    expect(r.band).toBe("High");
    expect(r.score).toBe(45); // one high alert = 45 points
    expect(r.contributors.some((c) => c.vital === "weight")).toBe(true);
  });

  it("ignores stale readings outside the recency window (→ Stable)", () => {
    const observations = [obs(LOINC_SBP, 80, daysAgo(30), "mm[Hg]")];
    const r = riskFromObservations("p1", observations, NOW);
    expect(r.band).toBe("Stable");
  });
});
