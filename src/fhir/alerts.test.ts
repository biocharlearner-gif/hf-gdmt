import { describe, it, expect } from "vitest";
import { buildAlertInput } from "./extract";
import { buildDetectedIssue, buildFlagForAlert, buildTaskForAlert } from "./writeback";
import { evaluateAlerts, type GdmtAlert } from "../engine/alerts";

const NOW = "2026-06-16T00:00:00.000Z";
const daysAgo = (n: number) => new Date(new Date(NOW).getTime() - n * 86400000).toISOString();

function weightObs(loinc: string, value: number, unit: string, date: string) {
  return {
    resourceType: "Observation",
    code: { coding: [{ system: "http://loinc.org", code: loinc }] },
    valueQuantity: { value, unit },
    effectiveDateTime: date,
  };
}
function vitalObs(loinc: string, value: number, date: string) {
  return {
    resourceType: "Observation",
    code: { coding: [{ system: "http://loinc.org", code: loinc }] },
    valueQuantity: { value },
    effectiveDateTime: date,
  };
}

describe("buildAlertInput — ingest", () => {
  it("builds a chronological kg weight series and latest vitals", () => {
    const input = buildAlertInput({
      patientId: "p1",
      now: NOW,
      observations: [
        weightObs("29463-7", 80, "kg", daysAgo(7)),
        weightObs("29463-7", 83, "kg", daysAgo(0)),
        vitalObs("8480-6", 88, daysAgo(0)), // SBP
        vitalObs("8867-4", 64, daysAgo(0)), // HR
        vitalObs("59408-5", 97, daysAgo(0)), // SpO2
      ],
    });
    expect(input.weightSeriesKg?.map((r) => r.value)).toEqual([80, 83]);
    expect(input.systolicBp?.value).toBe(88);
    expect(input.heartRate?.value).toBe(64);
    expect(input.spo2?.value).toBe(97);
  });

  it("converts lb weights to kg", () => {
    const input = buildAlertInput({
      patientId: "p1",
      now: NOW,
      observations: [weightObs("29463-7", 200, "[lb_av]", daysAgo(0))],
    });
    expect(input.weightSeriesKg?.[0]?.value).toBeCloseTo(90.7, 1);
  });

  it("feeds end-to-end into the engine and fires the weight alert", () => {
    const input = buildAlertInput({
      patientId: "p1",
      now: NOW,
      observations: [
        weightObs("29463-7", 80, "kg", daysAgo(7)),
        weightObs("29463-7", 83, "kg", daysAgo(0)),
      ],
    });
    const alerts = evaluateAlerts(input);
    expect(alerts.some((a) => a.id === "weight-gain-7d")).toBe(true);
  });
});

describe("alert writeback builders", () => {
  const alert: GdmtAlert = {
    id: "weight-gain-7d",
    severity: "high",
    kind: "threshold",
    vital: "weight",
    title: "Possible fluid retention — weight gain",
    detail: "Weight rose 3 kg over 7 days.",
    observed: "+3 kg over 7 day(s)",
    threshold: "≥ 2.3 kg / 7 day(s)",
    citationRef: "HFSA-selfcare-weight-monitoring",
    triggeredBy: [
      { value: 80, date: daysAgo(7) },
      { value: 83, date: daysAgo(0) },
    ],
  };
  const opts = { patientRef: "Patient/p1", observationRefs: ["Observation/o2"] };

  it("DetectedIssue carries severity, citation and evidence", () => {
    const di = buildDetectedIssue(alert, opts);
    expect(di.resourceType).toBe("DetectedIssue");
    expect(di.severity).toBe("high");
    expect(String(di.detail)).toContain("HFSA-selfcare-weight-monitoring");
    expect(di.evidence).toBeDefined();
  });

  it("Flag is active and scoped to the patient", () => {
    const flag = buildFlagForAlert(alert, opts);
    expect(flag.resourceType).toBe("Flag");
    expect(flag.status).toBe("active");
    expect((flag.subject as any).reference).toBe("Patient/p1");
  });

  it("Task priority escalates with severity", () => {
    const task = buildTaskForAlert(alert, opts);
    expect(task.priority).toBe("urgent");
    const low = buildTaskForAlert({ ...alert, severity: "low" }, opts);
    expect(low.priority).toBe("routine");
  });
});
