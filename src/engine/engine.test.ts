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

describe("evaluateGdmt — titration timing", () => {
  // NOW is 2026-06-16; carvedilol 12.5 of a 50 mg target is ON_SUBTARGET.
  const daysBefore = (n: number) =>
    new Date(new Date(NOW).getTime() - n * 24 * 60 * 60 * 1000).toISOString();
  const subTargetBB = (startedOn?: string) => ({
    name: "carvedilol", pillar: "BetaBlocker" as const, dailyDoseMg: 12.5, active: true, startedOn,
  });
  const bbOf = (input: Parameters<typeof baseInput>[0]) =>
    evaluateGdmt(baseInput(input)).pillars.find((p) => p.id === "BetaBlocker")!;

  it("flags a sub-target agent past the titration interval as overdue", () => {
    const bb = bbOf({ medications: [subTargetBB(daysBefore(30))] });
    expect(bb.status).toBe("ON_SUBTARGET");
    expect(bb.titration).toBeDefined();
    expect(bb.titration!.overdue).toBe(true);
    expect(bb.titration!.daysOnTherapy).toBe(30);
    expect(bb.agent!.startedOn).toBe(daysBefore(30));
  });

  it("does not flag a recently started sub-target agent", () => {
    const bb = bbOf({ medications: [subTargetBB(daysBefore(5))] });
    expect(bb.status).toBe("ON_SUBTARGET");
    expect(bb.titration!.overdue).toBe(false);
  });

  it("never flags an on-target agent regardless of how long ago it started", () => {
    const bb = bbOf({
      medications: [{ name: "carvedilol", pillar: "BetaBlocker", dailyDoseMg: 50, active: true, startedOn: daysBefore(365) }],
    });
    expect(bb.status).toBe("ON_TARGET");
    expect(bb.titration!.overdue).toBe(false);
  });

  it("omits titration when the agent has no start date", () => {
    const bb = bbOf({ medications: [subTargetBB(undefined)] });
    expect(bb.status).toBe("ON_SUBTARGET");
    expect(bb.titration).toBeUndefined();
    expect(bb.agent!.startedOn).toBeUndefined();
  });
});
