import type { GdmtAssessment, PillarResult } from "../engine/types";
import { KNOWLEDGE_BASE, type KbChunk } from "./knowledgeBase";

/**
 * Deterministic retrieval over the curated knowledge base. Given the engine's facts
 * for one pillar, select the most relevant cited chunks by (1) pillar match and
 * (2) overlap between the chunk's topic tags and query terms derived from the pillar's
 * status/reason. No embeddings/vector store: the KB is small and curated, and a
 * deterministic retriever fits the "engine decides" ethos — the same facts always
 * retrieve the same evidence, so the grounding is auditable and testable.
 */

const STATUS_TOPICS: Record<PillarResult["status"], string[]> = {
  GAP_ELIGIBLE: ["initiation", "recommendation", "mortality"],
  ON_SUBTARGET: ["titration", "dose", "target", "uptitration"],
  GAP_LABS_NEEDED: ["labs", "gating", "potassium", "renal", "egfr"],
  CONTRAINDICATED: ["contraindication", "safety"],
  ON_TARGET: ["recommendation", "benefit", "mortality"],
  INSUFFICIENT_DATA: ["phenotype", "recommendation"],
};

/** Extra query terms mined from the free-text reason (contra-reasons, gating specifics). */
function reasonTerms(reason: string): string[] {
  const r = reason.toLowerCase();
  const terms: string[] = [];
  if (/hyperkalemia|potassium|k\+/.test(r)) terms.push("potassium", "hyperkalemia");
  if (/egfr|renal|kidney|creatinine/.test(r)) terms.push("renal", "egfr");
  if (/angioedema/.test(r)) terms.push("angioedema");
  if (/hypotension|sbp|blood pressure/.test(r)) terms.push("sbp", "hypotension");
  if (/bradycardia|heart rate|hr /.test(r)) terms.push("hr", "bradycardia");
  if (/lab|stale|missing/.test(r)) terms.push("labs", "gating");
  return terms;
}

/** Build the query-term set for a pillar from the engine facts (status + reason + phenotype). */
export function queryTermsFor(assessment: GdmtAssessment, pillar: PillarResult): string[] {
  const terms = new Set<string>(STATUS_TOPICS[pillar.status]);
  for (const t of reasonTerms(pillar.reason)) terms.add(t);
  if (assessment.phenotype === "Unknown") terms.add("phenotype");
  if (pillar.id === "SGLT2i" && assessment.phenotype !== "HFrEF") terms.add("spectrum");
  return [...terms];
}

/** Score a chunk for a pillar: pillar match is worth the most, then topic overlap. */
function scoreChunk(chunk: KbChunk, pillarId: PillarResult["id"], terms: string[]): number {
  let score = 0;
  if (chunk.pillar === pillarId) score += 5;
  else if (chunk.pillar === "all") score += 1; // cross-cutting still eligible
  else return -1; // a different pillar's chunk is never relevant here
  for (const t of chunk.topics) if (terms.includes(t)) score += 2;
  return score;
}

/**
 * Retrieve the top-`limit` cited chunks grounding one pillar's assessment. Ties are
 * broken by KB order so results are stable.
 */
export function retrieveForPillar(
  assessment: GdmtAssessment,
  pillar: PillarResult,
  limit = 3,
): KbChunk[] {
  const terms = queryTermsFor(assessment, pillar);
  return KNOWLEDGE_BASE.map((chunk, idx) => ({ chunk, idx, score: scoreChunk(chunk, pillar.id, terms) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.idx - b.idx)
    .slice(0, limit)
    .map((r) => r.chunk);
}
