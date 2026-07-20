import Anthropic from "@anthropic-ai/sdk";
import type { GdmtAssessment, PillarResult, PillarStatus, PillarId } from "../engine/types";
import { isApplicablePillar } from "../engine/engine";
import { retrieveForPillar } from "./retrieve";
import type { KbChunk } from "./knowledgeBase";

/**
 * RAG cited-explanation module (feature C4) — the "AI explains" half of the
 * engine-decides / AI-explains split.
 *
 * IMPORTANT — server-side ONLY: the LLM path uses your Anthropic API key. The browser
 * calls the /api/rationale endpoint; that endpoint calls Anthropic.
 *
 * Grounding & safety:
 *  - The deterministic ENGINE decides status/dose/eligibility. This module only renders
 *    the *rationale*, grounded strictly in {engine facts + retrieved cited chunks}.
 *  - CITATIONS come from the retriever (curated KB), never from the LLM — so the model
 *    cannot invent a source. The LLM only writes prose; the citation ids are attached
 *    deterministically afterwards.
 *  - There are two renderers: an LLM path (Anthropic) and a DETERMINISTIC fallback that
 *    assembles cited prose from the same facts+chunks. The endpoint uses the LLM when a
 *    key is configured and falls back to deterministic on missing key or any error, so
 *    the demo never breaks.
 */

export interface PillarRationale {
  pillarId: PillarId;
  label: string;
  status: PillarStatus;
  /** Grounded plain-language explanation (engine facts + retrieved evidence). */
  text: string;
  /** Citation ids used (into src/engine/citations.ts). Retriever-controlled. */
  citations: string[];
  /** How the prose was produced. */
  source: "engine" | "llm";
}

export interface RationaleResult {
  patientId: string;
  pillars: PillarRationale[];
  generatedAt: string;
}

/** One pillar's grounding bundle: the engine facts + the retrieved cited chunks. */
interface PillarGrounding {
  pillar: PillarResult;
  chunks: KbChunk[];
}

/** Pillars worth explaining (skip fully-optimal and non-applicable ones). */
const EXPLAINABLE: ReadonlySet<PillarStatus> = new Set<PillarStatus>([
  "GAP_ELIGIBLE",
  "ON_SUBTARGET",
  "GAP_LABS_NEEDED",
  "CONTRAINDICATED",
  "INSUFFICIENT_DATA",
]);

/** Build per-pillar grounding for the applicable, non-optimal pillars. Pure. */
export function buildGrounding(assessment: GdmtAssessment): PillarGrounding[] {
  return assessment.pillars
    .filter((p) => isApplicablePillar(assessment.phenotype, p.id) && EXPLAINABLE.has(p.status))
    .map((pillar) => ({ pillar, chunks: retrieveForPillar(assessment, pillar) }));
}

// ---- Deterministic renderer (no LLM) ---------------------------------------

/** Assemble a grounded, cited sentence from the engine reason + the top chunk. Pure. */
function renderDeterministic(g: PillarGrounding): PillarRationale {
  const lead = g.pillar.reason.replace(/\s+$/, "");
  const evidence = g.chunks[0]?.statement;
  const text = evidence ? `${lead}. Guideline basis: ${evidence}` : lead;
  return {
    pillarId: g.pillar.id,
    label: g.pillar.label,
    status: g.pillar.status,
    text,
    citations: uniqueCitations(g.chunks),
    source: "engine",
  };
}

function uniqueCitations(chunks: KbChunk[]): string[] {
  return [...new Set(chunks.map((c) => c.citationRef))];
}

export function renderDeterministicRationale(assessment: GdmtAssessment): RationaleResult {
  return {
    patientId: assessment.patientId,
    pillars: buildGrounding(assessment).map(renderDeterministic),
    generatedAt: new Date().toISOString(),
  };
}

// ---- LLM renderer (Anthropic, grounded) ------------------------------------

export const DEFAULT_MODEL = "claude-opus-4-8";

const SYSTEM_PROMPT = `You are a clinical writing assistant for a heart-failure GDMT decision-support tool.
A deterministic rule engine has already decided each recommendation. Your ONLY job is to render a short, plain-language rationale for each pillar, grounded STRICTLY in the FACTS and the RETRIEVED GUIDELINE EVIDENCE provided.

Rules:
- Use ONLY the given facts and retrieved evidence. Never invent or alter lab values, doses, drug names, scores, thresholds, or recommendations.
- Do not add clinical claims that are not supported by the provided material.
- Frame everything as guideline-based decision support that requires clinician judgement. Never phrase as an order or auto-prescription.
- Do NOT write citations, section numbers, or URLs yourself — the application attaches citations separately.
- Write 1–2 sentences per pillar, clinically literate and concise.
Return STRICT JSON: {"pillars":[{"id":"<pillar id>","text":"<rationale>"}]}. No markdown, no preamble.`;

function groundingToPrompt(assessment: GdmtAssessment, grounding: PillarGrounding[]): string {
  const pillars = grounding.map((g) => ({
    id: g.pillar.id,
    label: g.pillar.label,
    status: g.pillar.status,
    engineReason: g.pillar.reason,
    gating: g.pillar.gating,
    retrievedEvidence: g.chunks.map((c) => c.statement),
  }));
  const context = {
    phenotype: assessment.phenotype,
    lvef: assessment.lvef,
    gdmtScore: assessment.gdmtScore,
  };
  return (
    `CONTEXT: ${JSON.stringify(context)}\n\n` +
    `PILLARS (write a rationale for each id):\n${JSON.stringify(pillars, null, 2)}`
  );
}

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    pillars: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false,
      },
    },
  },
  required: ["pillars"],
  additionalProperties: false,
} as const;

/**
 * Render rationale via Anthropic, grounded in facts+chunks. Returns per-pillar prose;
 * citations are attached from the retriever (not the model). Throws on API error so the
 * caller can fall back to the deterministic renderer.
 */
export async function generateRationaleLLM(
  assessment: GdmtAssessment,
  opts: { apiKey: string; model?: string },
): Promise<RationaleResult> {
  const grounding = buildGrounding(assessment);
  if (grounding.length === 0) {
    return { patientId: assessment.patientId, pillars: [], generatedAt: new Date().toISOString() };
  }

  const client = new Anthropic({ apiKey: opts.apiKey });

  const message = await client.messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: groundingToPrompt(assessment, grounding) }],
  } as never);

  const text = ((message as { content: { type: string; text?: string }[] }).content ?? [])
    .filter((b) => b.type === "text")
    .map((b) => b.text ?? "")
    .join("")
    .trim();

  const parsed = JSON.parse(text) as { pillars?: { id?: string; text?: string }[] };
  const byId = new Map((parsed.pillars ?? []).map((p) => [p.id, p.text ?? ""]));

  // Attach retriever-controlled citations; fall back to deterministic prose per pillar
  // if the model omitted one (defence in depth — never drop a pillar).
  return {
    patientId: assessment.patientId,
    generatedAt: new Date().toISOString(),
    pillars: grounding.map((g) => {
      const llmText = byId.get(g.pillar.id)?.trim();
      if (llmText) {
        return {
          pillarId: g.pillar.id,
          label: g.pillar.label,
          status: g.pillar.status,
          text: llmText,
          citations: uniqueCitations(g.chunks),
          source: "llm" as const,
        };
      }
      return renderDeterministic(g);
    }),
  };
}

/**
 * Top-level entry the endpoint calls. Uses the LLM when a key is present; otherwise (or
 * on any LLM error) renders the deterministic cited fallback so the demo never breaks.
 */
export async function generateRationale(
  assessment: GdmtAssessment,
  opts: { apiKey?: string; model?: string } = {},
): Promise<RationaleResult> {
  if (!opts.apiKey) return renderDeterministicRationale(assessment);
  try {
    return await generateRationaleLLM(assessment, { apiKey: opts.apiKey, model: opts.model });
  } catch {
    return renderDeterministicRationale(assessment);
  }
}
