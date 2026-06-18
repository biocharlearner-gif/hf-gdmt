import { describe, it, expect } from "vitest";
import { evaluateGdmt, determinePhenotype } from "./engine";
import type { EngineInput } from "./types";

const NOW = "2026-06-16T00:00:00.000Z";
const recent = (value: number) => ({ value, date: "2026-05-20T00:00:00.000Z" });

function baseInput(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    patientId: "p1",
    now: NOW,
    lvef: recent(30),
    medications: [],
    labs: { potassium: recent(4.2), egfr: recent(60) },
    vitals: { systolicBp: recent(120), heartRate: recent(72) },
    flags: {},
    ...overrides,
  };
}

describe("determinePhenotype", () => {
  it("classifies by LVEF thresholds", () => {
    expect(determinePhenotype(30)).toBe("HFrEF");
    expect(determinePhenotype(45)).toBe("HFmrEF");
    expect(determinePhenotype(55)).toBe("HFpEF");
    expect(determinePhenotype(undefined)).toBe("Unknown");
  });
});

describe("evaluateGdmt", () => {
  it("flags all four pillars as eligible gaps for an untreated HFrEF patient with good labs", () => {
    const a = evaluateGdmt(baseInput());
    expect(a.phenotype).toBe("HFrEF");
    expect(a.gdmtScore).toBe(0);
    expect(a.pillars.map((p) => p.status)).toEqual([
      "GAP_ELIGIBLE", "GAP_ELIGIBLE", "GAP_ELIGIBLE", "GAP_ELIGIBLE",
    ]);
  });

  it("counts an active on-target agent toward the score", () => {
    const a = evaluateGdmt(baseInput({
      medications: [{ name: "carvedilol", pillar: "BetaBlocker", dailyDoseMg: 50, active: true }],
    }));
    expect(a.gdmtScore).toBe(1);
    const bb = a.pillars.find((p) => p.id === "BetaBlocker")!;
    expect(bb.status).toBe("ON_TARGET");
  });

  it("contraindicates MRA when potassium is high", () => {
    const a = evaluateGdmt(baseInput({ labs: { potassium: recent(5.6), egfr: recent(60) } }));
    const mra = a.pillars.find((p) => p.id === "MRA")!;
    expect(mra.status).toBe("CONTRAINDICATED");
  });

  it("requests labs when gating labs are missing", () => {
    const a = evaluateGdmt(baseInput({ labs: {} }));
    const mra = a.pillars.find((p) => p.id === "MRA")!;
    expect(mra.status).toBe("GAP_LABS_NEEDED");
    expect(a.labsNeeded.length).toBeGreaterThan(0);
  });
});
