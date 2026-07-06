import { describe, it, expect } from "vitest";
import { computeRiskScore } from "./risk";
import type { GdmtAlert } from "./alerts";

const alert = (severity: GdmtAlert["severity"], vital: GdmtAlert["vital"]): GdmtAlert => ({
  id: `${vital}-${severity}`,
  severity,
  kind: "threshold",
  vital,
  title: `${vital} ${severity}`,
  detail: "",
  observed: "",
  threshold: "",
  citationRef: "ref",
  triggeredBy: [],
});

describe("computeRiskScore", () => {
  it("is 0 / Stable with no alerts", () => {
    const r = computeRiskScore([]);
    expect(r.score).toBe(0);
    expect(r.band).toBe("Stable");
    expect(r.contributors).toHaveLength(0);
  });

  it("scores a single high alert into the High band", () => {
    const r = computeRiskScore([alert("high", "spo2")]);
    expect(r.score).toBe(45);
    expect(r.band).toBe("High");
  });

  it("sums multiple alerts and reaches Critical", () => {
    const r = computeRiskScore([alert("high", "weight"), alert("high", "spo2")]);
    expect(r.score).toBe(90);
    expect(r.band).toBe("Critical");
    expect(r.contributors).toHaveLength(2);
  });

  it("caps the score at 100", () => {
    const r = computeRiskScore([alert("high", "weight"), alert("high", "spo2"), alert("moderate", "bloodPressure")]);
    expect(r.score).toBe(100);
  });

  it("classifies moderate-only as Moderate", () => {
    const r = computeRiskScore([alert("moderate", "bloodPressure")]);
    expect(r.score).toBe(22);
    expect(r.band).toBe("Moderate");
  });
});
