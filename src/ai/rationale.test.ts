import { describe, it, expect } from "vitest";
import type { GdmtAssessment, PillarResult, Phenotype } from "../engine/types";
import { retrieveForPillar, queryTermsFor } from "./retrieve";
import { buildGrounding, renderDeterministicRationale } from "./rationale";
import { prebakedRationale } from "./prebaked";
import { CITATIONS } from "../engine/citations";

function pillar(over: Partial<PillarResult> & Pick<PillarResult, "id" | "status">): PillarResult {
  return {
    label: over.id,
    reason: "",
    gating: {},
    citationRef: "AHA-ACC-HFSA-2022-7.3.1",
    ...over,
  } as PillarResult;
}

function assessment(phenotype: Phenotype, pillars: PillarResult[]): GdmtAssessment {
  return {
    patientId: "p1",
    phenotype,
    lvef: phenotype === "HFrEF" ? 30 : undefined,
    gdmtScore: 0,
    optimizationPct: 0,
    pillars,
    labsNeeded: [],
    generatedAt: "2026-07-20T00:00:00Z",
  };
}

describe("retrieveForPillar", () => {
  it("retrieves the pillar's own chunks, ranked above cross-cutting ones", () => {
    const a = assessment("HFrEF", [pillar({ id: "MRA", status: "GAP_ELIGIBLE", reason: "Not on an MRA; eligible now" })]);
    const chunks = retrieveForPillar(a, a.pillars[0]!);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks[0]!.pillar).toBe("MRA"); // pillar match outscores "all"
    // never returns another pillar's chunk
    expect(chunks.every((c) => c.pillar === "MRA" || c.pillar === "all")).toBe(true);
  });

  it("surfaces the hyperkalemia gate when an MRA is contraindicated for high K+", () => {
    const a = assessment("HFrEF", [
      pillar({ id: "MRA", status: "CONTRAINDICATED", reason: "K+ 5.2 > 5 — avoid MRA (hyperkalemia risk)" }),
    ]);
    const terms = queryTermsFor(a, a.pillars[0]!);
    expect(terms).toEqual(expect.arrayContaining(["contraindication", "potassium", "hyperkalemia"]));
    const ids = retrieveForPillar(a, a.pillars[0]!).map((c) => c.id);
    expect(ids).toContain("mra-renal-k-gate");
  });

  it("adds spectrum evidence for SGLT2i in a non-HFrEF phenotype", () => {
    const a = assessment("HFpEF", [pillar({ id: "SGLT2i", status: "GAP_ELIGIBLE", reason: "Eligible across the spectrum" })]);
    expect(queryTermsFor(a, a.pillars[0]!)).toContain("spectrum");
    expect(retrieveForPillar(a, a.pillars[0]!).map((c) => c.id)).toContain("sglt2-spectrum");
  });
});

describe("prebaked rationale coverage", () => {
  const PILLARS = ["RAASi", "BetaBlocker", "MRA", "SGLT2i"] as const;
  const STATUSES = ["GAP_ELIGIBLE", "ON_SUBTARGET", "GAP_LABS_NEEDED", "CONTRAINDICATED", "INSUFFICIENT_DATA"] as const;

  it("has AI-drafted prose for every explainable (pillar x status) scenario", () => {
    for (const p of PILLARS) {
      for (const s of STATUSES) {
        expect(prebakedRationale(p, s), `${p}:${s}`).toBeTruthy();
      }
    }
  });
});

describe("renderDeterministicRationale", () => {
  it("explains actionable applicable pillars, cites a KNOWN reference, and skips on-target ones", () => {
    const a = assessment("HFrEF", [
      pillar({ id: "RAASi", status: "GAP_ELIGIBLE", reason: "Not on a RAAS inhibitor; eligible" }),
      pillar({ id: "BetaBlocker", status: "ON_TARGET", reason: "On carvedilol at target" }),
    ]);
    const result = renderDeterministicRationale(a);
    // ON_TARGET is skipped; only the eligible gap is explained
    expect(result.pillars.map((p) => p.pillarId)).toEqual(["RAASi"]);
    const r = result.pillars[0]!;
    // Applicable (pillar × status) scenarios are AI-drafted (pre-baked), no runtime LLM.
    expect(r.source).toBe("prebaked");
    expect(r.text).toContain("RAAS inhibitor"); // grounded prose for the eligible-gap scenario
    expect(r.citations.length).toBeGreaterThan(0);
    // every attached citation resolves in the registry (retriever-controlled, not invented)
    for (const c of r.citations) expect(CITATIONS[c]).toBeDefined();
  });

  it("does not explain SGLT2i-only muted pillars for a non-HFrEF phenotype's RAASi", () => {
    // For HFpEF, only SGLT2i is applicable — RAASi/BB/MRA are not part of the program.
    const a = assessment("HFpEF", [
      pillar({ id: "RAASi", status: "GAP_ELIGIBLE", reason: "n/a for HFpEF program" }),
      pillar({ id: "SGLT2i", status: "GAP_ELIGIBLE", reason: "Eligible" }),
    ]);
    const ids = buildGrounding(a).map((g) => g.pillar.id);
    expect(ids).toEqual(["SGLT2i"]);
  });
});
