import { describe, it, expect } from "vitest";
import { carePlanSummaryHtml } from "./carePlanSummary";
import { evaluateGdmt } from "../engine/engine";
import { projectBenefit } from "../engine/benefit";
import type { EngineInput } from "../engine/types";
import type { FhirPatient } from "./patientMapper";

const NOW = "2026-06-16T00:00:00.000Z";
const recent = (value: number) => ({ value, date: "2026-05-20T00:00:00.000Z" });

const patient: FhirPatient = {
  resourceType: "Patient",
  id: "p1",
  name: [{ family: "Reyes", given: ["Eleanor"] }],
  gender: "female",
  birthDate: "1948-03-12",
};

const assessment = evaluateGdmt({
  patientId: "p1",
  now: NOW,
  lvef: recent(28),
  medications: [],
  labs: { potassium: recent(4.2), egfr: recent(60) },
  vitals: { systolicBp: recent(120), heartRate: recent(72) },
  flags: {},
} satisfies EngineInput);

describe("carePlanSummaryHtml", () => {
  const html = carePlanSummaryHtml({ patient, assessment, benefit: projectBenefit(assessment), generatedBy: "Dr. Smith" });

  it("is a self-contained HTML document", () => {
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain("<style>");
  });

  it("includes patient identity and every applicable pillar", () => {
    expect(html).toContain("Eleanor Reyes");
    for (const label of ["RAAS inhibition", "beta-blocker", "Mineralocorticoid", "SGLT2"]) {
      expect(html).toContain(label);
    }
  });

  it("carries the decision-support disclaimer and the author", () => {
    expect(html).toContain("Decision support, not a prescription");
    expect(html).toContain("Dr. Smith");
  });

  it("escapes to avoid broken markup", () => {
    expect(html).not.toContain("<script>");
  });
});
