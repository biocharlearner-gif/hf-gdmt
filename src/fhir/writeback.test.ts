import { describe, it, expect } from "vitest";
import { buildCarePlan, pillarActivityStatus } from "./writeback";
import { evaluateGdmt } from "../engine/engine";
import type { EngineInput, MedicationFact, PillarStatus } from "../engine/types";

const NOW = "2026-06-16T00:00:00.000Z";
const recent = (value: number) => ({ value, date: "2026-05-20T00:00:00.000Z" });

function input(overrides: Partial<EngineInput> = {}): EngineInput {
  return {
    patientId: "p1",
    now: NOW,
    lvef: recent(30), // HFrEF → all four pillars applicable
    medications: [],
    labs: { potassium: recent(4.2), egfr: recent(60) },
    vitals: { systolicBp: recent(120), heartRate: recent(72) },
    flags: {},
    ...overrides,
  };
}

describe("pillarActivityStatus", () => {
  const cases: [PillarStatus, string][] = [
    ["ON_TARGET", "completed"],
    ["ON_SUBTARGET", "in-progress"],
    ["GAP_ELIGIBLE", "not-started"],
    ["GAP_LABS_NEEDED", "not-started"],
    ["CONTRAINDICATED", "on-hold"],
    ["INSUFFICIENT_DATA", "unknown"],
  ];
  it.each(cases)("maps %s → %s", (status, expected) => {
    expect(pillarActivityStatus(status)).toBe(expected);
  });
});

describe("buildCarePlan", () => {
  it("builds a rich HFrEF CarePlan: goals, one activity per applicable pillar, author, addresses", () => {
    const assessment = evaluateGdmt(input());
    const cp = buildCarePlan(assessment, ["Task/t1"], {
      patientRef: "Patient/p1",
      conditionRef: "Condition/c1",
      authorDisplay: "Dr. Smith",
    }) as Record<string, unknown>;

    // Contained goals + goal references that point at them.
    const contained = cp.contained as { id: string; resourceType: string }[];
    expect(contained.length).toBeGreaterThanOrEqual(1);
    expect(contained.every((g) => g.resourceType === "Goal")).toBe(true);
    expect(cp.goal).toEqual(contained.map((g) => ({ reference: `#${g.id}` })));

    // One detail-activity per applicable pillar (4 for HFrEF) + the linked Task reference.
    const activity = cp.activity as { detail?: { status: string }; reference?: { reference: string } }[];
    const detailActs = activity.filter((a) => a.detail);
    expect(detailActs).toHaveLength(4);
    // Untreated → every pillar not-started (eligible/labs-needed).
    expect(detailActs.every((a) => a.detail!.status === "not-started")).toBe(true);
    expect(activity.some((a) => a.reference?.reference === "Task/t1")).toBe(true);

    expect(cp.author).toEqual({ display: "Dr. Smith" });
    expect(cp.addresses).toEqual([{ reference: "Condition/c1" }]);
    expect(cp.period).toMatchObject({ start: expect.any(String) });
  });

  it("reflects an on-target pillar as a completed activity", () => {
    const meds: MedicationFact[] = [{ name: "carvedilol", pillar: "BetaBlocker", dailyDoseMg: 50, active: true }];
    const assessment = evaluateGdmt(input({ medications: meds }));
    const cp = buildCarePlan(assessment, [], { patientRef: "Patient/p1" }) as Record<string, unknown>;
    const activity = cp.activity as { detail?: { code?: { text?: string }; status: string } }[];
    const bb = activity.find((a) => a.detail?.code?.text?.includes("beta-blocker"));
    expect(bb?.detail?.status).toBe("completed");
    // No author / addresses when not supplied.
    expect(cp.author).toBeUndefined();
    expect(cp.addresses).toBeUndefined();
  });

  it("scopes activities to the single applicable pillar for HFmrEF (SGLT2i only)", () => {
    const assessment = evaluateGdmt(input({ lvef: recent(45) })); // HFmrEF
    const cp = buildCarePlan(assessment, [], { patientRef: "Patient/p1" }) as Record<string, unknown>;
    const detailActs = (cp.activity as { detail?: unknown }[]).filter((a) => a.detail);
    expect(detailActs).toHaveLength(1);
  });
});
