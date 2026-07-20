/**
 * Source for /api/rationale — RAG cited-explanation endpoint (server-side only).
 *
 * The SPA computes the deterministic GdmtAssessment (engine runs client-side) and POSTs
 * it here; this endpoint retrieves cited guideline chunks and renders a grounded
 * rationale per pillar. Uses the Anthropic LLM when ANTHROPIC_API_KEY is set, else falls
 * back to the deterministic cited renderer — so the demo never breaks. The API key stays
 * server-side and never reaches the browser bundle.
 */
import { generateRationale } from "../src/ai/rationale";
import type { GdmtAssessment } from "../src/engine/types";

const API_KEY = process.env.ANTHROPIC_API_KEY || undefined;
const MODEL = process.env.ANTHROPIC_MODEL || undefined; // defaults to claude-opus-4-8

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

export default {
  async fetch(req: Request): Promise<Response> {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    try {
      const body = (await req.json().catch(() => ({}))) as { assessment?: GdmtAssessment };
      const assessment = body.assessment;
      if (!assessment || !Array.isArray(assessment.pillars)) {
        return json({ error: "expected { assessment: GdmtAssessment }" }, 400);
      }
      const result = await generateRationale(assessment, { apiKey: API_KEY, model: MODEL });
      // Report which renderer served it, so the UI can label AI vs deterministic.
      const usedLlm = result.pillars.some((p) => p.source === "llm");
      return json({ ...result, mode: usedLlm ? "llm" : "deterministic", llmConfigured: Boolean(API_KEY) });
    } catch (e) {
      console.error("[rationale] error", e);
      return json({ error: e instanceof Error ? e.message : "error" }, 500);
    }
  },
};
