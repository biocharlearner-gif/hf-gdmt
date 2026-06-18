import type { GdmtAssessment } from "../engine/types";

/**
 * AI rationale (feature C4). Generates a plain-English clinician summary AND an
 * optional patient-friendly explanation from the STRUCTURED assessment only.
 *
 * IMPORTANT — run this on your BACKEND, never the browser: it uses your Anthropic
 * API key. The browser calls your service; your service calls Anthropic.
 *
 * Grounding strategy: we pass the engine's structured output and instruct the model
 * to use ONLY those facts — no invented lab values, doses, or recommendations. The
 * engine remains the source of truth; the LLM only renders prose.
 */

export interface RationaleResult {
  clinicianSummary: string;
  patientSummary: string;
}

const SYSTEM_PROMPT = `You are a clinical writing assistant for a heart-failure GDMT decision-support tool.
You will receive a STRUCTURED assessment (JSON). Write explanations using ONLY the facts in that JSON.
Rules:
- Never invent or alter lab values, doses, drug names, scores, or recommendations.
- Do not add clinical claims that are not present in the input.
- Frame everything as guideline-based decision support requiring clinician judgement; never phrase as an order.
- Be concise and clinically literate.
Return STRICT JSON with exactly two string keys: "clinicianSummary" and "patientSummary". No markdown, no preamble.`;

export async function generateRationale(
  assessment: GdmtAssessment,
  opts: { apiKey: string; model?: string } ,
): Promise<RationaleResult> {
  const userContent =
    `Assessment JSON:\n${JSON.stringify(assessment, null, 2)}\n\n` +
    `Write: (1) clinicianSummary — 2–4 sentences on the GDMT gaps and next steps; ` +
    `(2) patientSummary — 2–3 plain-language sentences for the patient. Return strict JSON only.`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: opts.model ?? "claude-sonnet-4-6",
      max_tokens: 600,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API error: ${res.status} ${await res.text()}`);

  const data = await res.json();
  const text: string = (data.content ?? [])
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("")
    .trim();

  const cleaned = text.replace(/^```json\s*/i, "").replace(/```$/i, "").trim();
  try {
    const parsed = JSON.parse(cleaned);
    return {
      clinicianSummary: String(parsed.clinicianSummary ?? ""),
      patientSummary: String(parsed.patientSummary ?? ""),
    };
  } catch {
    // Fallback: if the model didn't return clean JSON, surface raw text safely.
    return { clinicianSummary: text, patientSummary: "" };
  }
}
