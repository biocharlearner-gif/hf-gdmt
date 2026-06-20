import { describe, it, expect } from "vitest";
import { evaluateAlerts } from "./alerts";
import type { AlertInput, VitalReading } from "./alerts";

const NOW = "2026-06-16T00:00:00.000Z";
const daysAgo = (n: number): string =>
  new Date(new Date(NOW).getTime() - n * 24 * 60 * 60 * 1000).toISOString();

function baseInput(overrides: Partial<AlertInput> = {}): AlertInput {
  return {
    patientId: "p1",
    now: NOW,
    weightSeriesKg: [],
    systolicBp: { value: 120, date: daysAgo(0) },
    heartRate: { value: 72, date: daysAgo(0) },
    spo2: { value: 98, date: daysAgo(0) },
    ...overrides,
  };
}

const series = (...pts: [daysAgo: number, kg: number][]): VitalReading[] =>
  pts.map(([d, value]) => ({ value, date: daysAgo(d) }));

describe("evaluateAlerts — weight", () => {
  it("fires a high-severity alert on >2.3 kg gain over a week", () => {
    const a = evaluateAlerts(baseInput({ weightSeriesKg: series([7, 80], [0, 83]) }));
    const w = a.find((x) => x.id === "weight-gain-7d");
    expect(w).toBeDefined();
    expect(w!.severity).toBe("high");
    expect(w!.citationRef).toBe("HFSA-selfcare-weight-monitoring");
    expect(w!.triggeredBy).toHaveLength(2);
  });

  it("fires an overnight alert on >0.9 kg gain in a day", () => {
    const a = evaluateAlerts(baseInput({ weightSeriesKg: series([1, 80], [0, 81]) }));
    expect(a.some((x) => x.id === "weight-gain-1d")).toBe(true);
  });

  it("does not fire on stable weight", () => {
    const a = evaluateAlerts(baseInput({ weightSeriesKg: series([7, 80], [3, 80.2], [0, 80.1]) }));
    expect(a.some((x) => x.vital === "weight")).toBe(false);
  });

  it("ignores a stale series whose latest reading is outside the recency window", () => {
    const a = evaluateAlerts(baseInput({ weightSeriesKg: series([40, 80], [33, 84]) }));
    expect(a.some((x) => x.vital === "weight")).toBe(false);
  });

  it("needs at least two readings", () => {
    const a = evaluateAlerts(baseInput({ weightSeriesKg: series([0, 90]) }));
    expect(a.some((x) => x.vital === "weight")).toBe(false);
  });
});

describe("evaluateAlerts — titration-safety vitals", () => {
  it("flags hypotension below 90 mmHg", () => {
    const a = evaluateAlerts(baseInput({ systolicBp: { value: 84, date: daysAgo(0) } }));
    expect(a.some((x) => x.id === "hypotension")).toBe(true);
  });

  it("flags bradycardia below 50 bpm", () => {
    const a = evaluateAlerts(baseInput({ heartRate: { value: 46, date: daysAgo(0) } }));
    expect(a.some((x) => x.id === "bradycardia")).toBe(true);
  });

  it("flags hypoxia below 90%", () => {
    const a = evaluateAlerts(baseInput({ spo2: { value: 88, date: daysAgo(0) } }));
    expect(a.some((x) => x.id === "hypoxia" && x.severity === "high")).toBe(true);
  });

  it("ignores stale vitals outside the recency window", () => {
    const a = evaluateAlerts(baseInput({ systolicBp: { value: 80, date: daysAgo(30) } }));
    expect(a.some((x) => x.id === "hypotension")).toBe(false);
  });

  it("returns no alerts for a stable patient", () => {
    expect(evaluateAlerts(baseInput())).toEqual([]);
  });
});
