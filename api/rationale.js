// src/ai/rationale.ts
import Anthropic from "@anthropic-ai/sdk";

// src/engine/codes.ts
var TARGET_DOSE_MG = {
  // RAASi
  "sacubitril/valsartan": 194 + 206,
  // target 97/103 mg BID -> ~400 mg/day combined salt
  "entresto": 400,
  lisinopril: 40,
  enalapril: 40,
  ramipril: 10,
  losartan: 150,
  valsartan: 320,
  candesartan: 32,
  // Beta-blockers
  carvedilol: 50,
  "metoprolol succinate": 200,
  metoprolol: 200,
  bisoprolol: 10,
  // MRA
  spironolactone: 50,
  eplerenone: 50,
  // SGLT2i (fixed dose — "at target" if on it)
  dapagliflozin: 10,
  empagliflozin: 10
};

// src/engine/rules.ts
var DAY_MS = 24 * 60 * 60 * 1e3;

// src/engine/engine.ts
function isApplicablePillar(phenotype, pillar) {
  if (phenotype === "HFrEF") return true;
  if (phenotype === "HFmrEF" || phenotype === "HFpEF") return pillar === "SGLT2i";
  return false;
}

// src/ai/knowledgeBase.ts
var KNOWLEDGE_BASE = [
  // ---- RAAS inhibition / ARNI (§7.3.1) --------------------------------------
  {
    id: "raasi-arni-class1",
    pillar: "RAASi",
    topics: ["initiation", "recommendation", "arni", "mortality"],
    statement: "In HFrEF, a renin-angiotensin system inhibitor is recommended to reduce mortality and HF hospitalization; an ARNI (sacubitril/valsartan) is preferred over an ACE inhibitor or ARB where feasible (Class 1).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1"
  },
  {
    id: "raasi-acei-arb-alt",
    pillar: "RAASi",
    topics: ["initiation", "alternative", "acei", "arb"],
    statement: "When an ARNI is not feasible, an ACE inhibitor is recommended; an ARB is recommended only if the patient is ACE-inhibitor intolerant (e.g. cough).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1"
  },
  {
    id: "raasi-angioedema-contra",
    pillar: "RAASi",
    topics: ["contraindication", "angioedema", "safety"],
    statement: "ARNI and ACE inhibitors are contraindicated in patients with a history of angioedema; allow a 36-hour washout when switching from an ACE inhibitor to an ARNI.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1"
  },
  {
    id: "raasi-hypotension-gate",
    pillar: "RAASi",
    topics: ["sbp", "hypotension", "gating", "titration"],
    statement: "Symptomatic hypotension limits initiation and up-titration of ARNI/ACEi/ARB; low systolic blood pressure warrants caution and slower titration rather than omission when asymptomatic.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1"
  },
  // ---- Beta-blockers (§7.3.2) ----------------------------------------------
  {
    id: "bb-class1",
    pillar: "BetaBlocker",
    topics: ["initiation", "recommendation", "mortality"],
    statement: "In HFrEF, one of the three evidence-based beta-blockers \u2014 bisoprolol, carvedilol, or sustained-release metoprolol succinate \u2014 is recommended to reduce mortality and hospitalization (Class 1).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.2"
  },
  {
    id: "bb-evidence-based-only",
    pillar: "BetaBlocker",
    topics: ["agent-selection", "safety"],
    statement: "Only the three trial-proven beta-blockers confer the mortality benefit in HFrEF; other beta-blockers should not be substituted for GDMT purposes.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.2"
  },
  {
    id: "bb-bradycardia-gate",
    pillar: "BetaBlocker",
    topics: ["hr", "bradycardia", "gating", "titration"],
    statement: "Bradycardia limits beta-blocker up-titration; initiate in euvolemic, stable patients and avoid starting or increasing during acute decompensation.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.2"
  },
  // ---- MRA (§7.3.3) ---------------------------------------------------------
  {
    id: "mra-class1",
    pillar: "MRA",
    topics: ["initiation", "recommendation", "mortality"],
    statement: "In HFrEF, a mineralocorticoid receptor antagonist (spironolactone or eplerenone) is recommended to reduce mortality and hospitalization when eGFR and serum potassium permit (Class 1).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3"
  },
  {
    id: "mra-renal-k-gate",
    pillar: "MRA",
    topics: ["contraindication", "potassium", "renal", "egfr", "hyperkalemia", "gating"],
    statement: "An MRA should not be started when serum potassium is elevated (>5.0 mmol/L) or renal function is significantly impaired (eGFR below ~30 mL/min/1.73m\xB2) because of hyperkalemia risk.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3"
  },
  {
    id: "mra-monitoring",
    pillar: "MRA",
    topics: ["monitoring", "potassium", "renal", "labs"],
    statement: "Monitor serum potassium and renal function shortly after starting or up-titrating an MRA, and periodically thereafter, to detect hyperkalemia or worsening renal function early.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3"
  },
  // ---- SGLT2 inhibitors (§7.3.4) -------------------------------------------
  {
    id: "sglt2-class1",
    pillar: "SGLT2i",
    topics: ["initiation", "recommendation", "mortality", "hospitalization"],
    statement: "An SGLT2 inhibitor (dapagliflozin or empagliflozin) is recommended in symptomatic HFrEF to reduce HF hospitalization and cardiovascular death, independent of diabetes status (Class 1).",
    citationRef: "AHA-ACC-HFSA-2022-7.3.4"
  },
  {
    id: "sglt2-spectrum",
    pillar: "SGLT2i",
    topics: ["phenotype", "hfmref", "hfpef", "spectrum"],
    statement: "SGLT2 inhibitors reduce HF hospitalization across the ejection-fraction spectrum, so they are reasonable in HFmrEF and HFpEF as well as HFrEF \u2014 the one pillar that applies beyond reduced EF.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.4"
  },
  // ---- Cross-cutting: titration, sequencing, benefit, transitions ----------
  {
    id: "titration-to-target",
    pillar: "all",
    topics: ["titration", "dose", "target", "uptitration"],
    statement: "After initiation, each GDMT medication should be up-titrated to the target dose used in trials (or the maximum tolerated dose), typically at intervals of about two weeks as blood pressure, heart rate, potassium, and renal function allow.",
    citationRef: "AHA-ACC-HFSA-2022-7.3-titration"
  },
  {
    id: "gdmt-sequencing-benefit",
    pillar: "all",
    topics: ["benefit", "sequencing", "mortality", "initiation"],
    statement: "Comprehensive, all-four-pillar GDMT produces substantially greater reductions in mortality and hospitalization than partial therapy; rapid sequential or simultaneous initiation of the pillars is encouraged rather than slow one-at-a-time escalation.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1"
  },
  {
    id: "labs-before-titration",
    pillar: "all",
    topics: ["labs", "potassium", "renal", "egfr", "gating", "stale"],
    statement: "Current potassium and renal-function values should be available before starting or up-titrating renally-active GDMT (RAAS inhibitors and MRAs); order labs first when values are missing or stale.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3"
  },
  {
    id: "post-discharge-vulnerable",
    pillar: "all",
    topics: ["transitions", "hospitalization", "post-discharge", "vulnerable"],
    statement: "GDMT should be initiated and optimized during and soon after an HF hospitalization; the early post-discharge period is a vulnerable phase in which starting or intensifying therapy is especially valuable.",
    citationRef: "AHA-ACC-HFSA-2022-8-transitions"
  },
  {
    id: "phenotype-lvef",
    pillar: "all",
    topics: ["phenotype", "lvef", "hfref", "needs-ef"],
    statement: "Left-ventricular ejection fraction defines the HF phenotype and which therapies carry a Class 1 mortality indication; the full four-pillar program is established for HFrEF (LVEF \u226440%), so a current EF is needed before committing to it.",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1"
  }
];

// src/ai/retrieve.ts
var STATUS_TOPICS = {
  GAP_ELIGIBLE: ["initiation", "recommendation", "mortality"],
  ON_SUBTARGET: ["titration", "dose", "target", "uptitration"],
  GAP_LABS_NEEDED: ["labs", "gating", "potassium", "renal", "egfr"],
  CONTRAINDICATED: ["contraindication", "safety"],
  ON_TARGET: ["recommendation", "benefit", "mortality"],
  INSUFFICIENT_DATA: ["phenotype", "recommendation"]
};
function reasonTerms(reason) {
  const r = reason.toLowerCase();
  const terms = [];
  if (/hyperkalemia|potassium|k\+/.test(r)) terms.push("potassium", "hyperkalemia");
  if (/egfr|renal|kidney|creatinine/.test(r)) terms.push("renal", "egfr");
  if (/angioedema/.test(r)) terms.push("angioedema");
  if (/hypotension|sbp|blood pressure/.test(r)) terms.push("sbp", "hypotension");
  if (/bradycardia|heart rate|hr /.test(r)) terms.push("hr", "bradycardia");
  if (/lab|stale|missing/.test(r)) terms.push("labs", "gating");
  return terms;
}
function queryTermsFor(assessment, pillar) {
  const terms = new Set(STATUS_TOPICS[pillar.status]);
  for (const t of reasonTerms(pillar.reason)) terms.add(t);
  if (assessment.phenotype === "Unknown") terms.add("phenotype");
  if (pillar.id === "SGLT2i" && assessment.phenotype !== "HFrEF") terms.add("spectrum");
  return [...terms];
}
function scoreChunk(chunk, pillarId, terms) {
  let score = 0;
  if (chunk.pillar === pillarId) score += 5;
  else if (chunk.pillar === "all") score += 1;
  else return -1;
  for (const t of chunk.topics) if (terms.includes(t)) score += 2;
  return score;
}
function retrieveForPillar(assessment, pillar, limit = 3) {
  const terms = queryTermsFor(assessment, pillar);
  return KNOWLEDGE_BASE.map((chunk, idx) => ({ chunk, idx, score: scoreChunk(chunk, pillar.id, terms) })).filter((r) => r.score > 0).sort((a, b) => b.score - a.score || a.idx - b.idx).slice(0, limit).map((r) => r.chunk);
}

// src/ai/prebaked.ts
var PREBAKED_RATIONALE = {
  // ---- RAAS inhibitor / ARNI (§7.3.1) --------------------------------------
  "RAASi:GAP_ELIGIBLE": "This patient has HFrEF and is not yet on a renin\u2013angiotensin system inhibitor despite meeting the criteria to start one. Guideline-directed therapy recommends a RAAS inhibitor \u2014 an ARNI preferred where feasible \u2014 to reduce mortality and heart-failure hospitalization, so initiating one is the next step for the care team to consider.",
  "RAASi:ON_SUBTARGET": "The patient is on a RAAS inhibitor but below the target dose shown to reduce mortality in trials. Guidelines advise up-titrating toward the target (or maximum tolerated) dose, typically at about two-week intervals as blood pressure and renal function allow.",
  "RAASi:GAP_LABS_NEEDED": "A RAAS inhibitor is indicated, but current potassium and renal-function values are needed before starting or adjusting it, since these medicines are renally active. The care team should obtain up-to-date labs first, then initiate.",
  "RAASi:CONTRAINDICATED": "A RAAS inhibitor is being withheld because a safety factor makes it inappropriate here \u2014 for example a history of angioedema (an absolute contraindication for ARNI and ACE inhibitors) or symptomatic hypotension. The specific factor the engine flagged should guide whether an alternative pathway or watchful waiting is appropriate.",
  "RAASi:INSUFFICIENT_DATA": "There isn't enough information to determine this patient's RAAS-inhibitor status. Confirming the current medication list and recent potassium/renal labs will let the engine assess eligibility.",
  // ---- Beta-blocker (§7.3.2) ------------------------------------------------
  "BetaBlocker:GAP_ELIGIBLE": "This HFrEF patient is not on one of the three evidence-based beta-blockers \u2014 bisoprolol, carvedilol, or sustained-release metoprolol succinate \u2014 that reduce mortality. Guidelines recommend starting one in a stable, euvolemic patient, so beta-blockade is the next therapy to consider.",
  "BetaBlocker:ON_SUBTARGET": "The patient is on an evidence-based beta-blocker but below the trial target dose. Up-titration toward target (or the maximum tolerated dose) is advised as heart rate and blood pressure allow, since the mortality benefit is dose-related.",
  "BetaBlocker:GAP_LABS_NEEDED": "Beta-blocker therapy is indicated; confirm the patient is clinically stable and euvolemic before initiating or increasing the dose.",
  "BetaBlocker:CONTRAINDICATED": "A beta-blocker is being held because of a limiting factor such as bradycardia or acute decompensation. Guidelines advise initiating only in stable patients and avoiding up-titration during decompensation; revisit once the limiting factor resolves.",
  "BetaBlocker:INSUFFICIENT_DATA": "There isn't enough information to assess beta-blocker status; confirming the current medication list will let the engine evaluate eligibility.",
  // ---- MRA (§7.3.3) ---------------------------------------------------------
  "MRA:GAP_ELIGIBLE": "This HFrEF patient is not on a mineralocorticoid receptor antagonist despite potassium and renal function that permit one. An MRA (spironolactone or eplerenone) carries a Class 1 mortality benefit here, so starting one \u2014 with follow-up potassium monitoring \u2014 is the next step to consider.",
  "MRA:ON_SUBTARGET": "The patient is on an MRA below the target dose; up-titration toward target is advised as potassium and renal function permit, with monitoring after each change.",
  "MRA:GAP_LABS_NEEDED": "An MRA is indicated, but current potassium and renal-function values are required before starting it because of hyperkalemia risk. Obtain up-to-date labs first, then initiate if they fall within the safe range.",
  "MRA:CONTRAINDICATED": "An MRA is being held because a safety threshold is outside the range where it can be started \u2014 elevated serum potassium or significantly reduced renal function. Guidelines advise against initiating an MRA in this setting given the hyperkalemia risk; recheck labs and reconsider once values normalize.",
  "MRA:INSUFFICIENT_DATA": "There isn't enough information to assess MRA status; confirming the medication list and recent potassium/renal labs will let the engine evaluate eligibility.",
  // ---- SGLT2 inhibitor (§7.3.4) --------------------------------------------
  "SGLT2i:GAP_ELIGIBLE": "This patient is not on an SGLT2 inhibitor, which reduces heart-failure hospitalization and cardiovascular death in symptomatic heart failure regardless of diabetes status \u2014 and benefits patients across the ejection-fraction spectrum, not only HFrEF. Initiating dapagliflozin or empagliflozin is the next step to consider.",
  "SGLT2i:ON_SUBTARGET": "SGLT2 inhibitors are given at a single fixed dose rather than titrated, so an on-therapy patient is generally already at goal; confirm continued tolerance and adherence.",
  "SGLT2i:GAP_LABS_NEEDED": "An SGLT2 inhibitor is indicated; confirm renal function is adequate for initiation, then start.",
  "SGLT2i:CONTRAINDICATED": "An SGLT2 inhibitor is being withheld because of a limiting factor, such as markedly reduced renal function or another listed contraindication. Revisit once the limiting factor is addressed.",
  "SGLT2i:INSUFFICIENT_DATA": "There isn't enough information to assess SGLT2-inhibitor status; confirming the current medication list will let the engine evaluate eligibility."
};
function prebakedRationale(pillarId, status) {
  return PREBAKED_RATIONALE[`${pillarId}:${status}`];
}

// src/ai/rationale.ts
var EXPLAINABLE = /* @__PURE__ */ new Set([
  "GAP_ELIGIBLE",
  "ON_SUBTARGET",
  "GAP_LABS_NEEDED",
  "CONTRAINDICATED",
  "INSUFFICIENT_DATA"
]);
function buildGrounding(assessment) {
  return assessment.pillars.filter((p) => isApplicablePillar(assessment.phenotype, p.id) && EXPLAINABLE.has(p.status)).map((pillar) => ({ pillar, chunks: retrieveForPillar(assessment, pillar) }));
}
function renderNoLlm(g) {
  const base = {
    pillarId: g.pillar.id,
    label: g.pillar.label,
    status: g.pillar.status,
    citations: uniqueCitations(g.chunks)
  };
  const pre = prebakedRationale(g.pillar.id, g.pillar.status);
  if (pre) return { ...base, text: pre, source: "prebaked" };
  const lead = g.pillar.reason.replace(/\s+$/, "");
  const evidence = g.chunks[0]?.statement;
  return { ...base, text: evidence ? `${lead}. Guideline basis: ${evidence}` : lead, source: "engine" };
}
function uniqueCitations(chunks) {
  return [...new Set(chunks.map((c) => c.citationRef))];
}
function renderDeterministicRationale(assessment) {
  return {
    patientId: assessment.patientId,
    pillars: buildGrounding(assessment).map(renderNoLlm),
    generatedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
}
var DEFAULT_MODEL = "claude-opus-4-8";
var SYSTEM_PROMPT = `You are a clinical writing assistant for a heart-failure GDMT decision-support tool.
A deterministic rule engine has already decided each recommendation. Your ONLY job is to render a short, plain-language rationale for each pillar, grounded STRICTLY in the FACTS and the RETRIEVED GUIDELINE EVIDENCE provided.

Rules:
- Use ONLY the given facts and retrieved evidence. Never invent or alter lab values, doses, drug names, scores, thresholds, or recommendations.
- Do not add clinical claims that are not supported by the provided material.
- Frame everything as guideline-based decision support that requires clinician judgement. Never phrase as an order or auto-prescription.
- Do NOT write citations, section numbers, or URLs yourself \u2014 the application attaches citations separately.
- Write 1\u20132 sentences per pillar, clinically literate and concise.
Return STRICT JSON: {"pillars":[{"id":"<pillar id>","text":"<rationale>"}]}. No markdown, no preamble.`;
function groundingToPrompt(assessment, grounding) {
  const pillars = grounding.map((g) => ({
    id: g.pillar.id,
    label: g.pillar.label,
    status: g.pillar.status,
    engineReason: g.pillar.reason,
    gating: g.pillar.gating,
    retrievedEvidence: g.chunks.map((c) => c.statement)
  }));
  const context = {
    phenotype: assessment.phenotype,
    lvef: assessment.lvef,
    gdmtScore: assessment.gdmtScore
  };
  return `CONTEXT: ${JSON.stringify(context)}

PILLARS (write a rationale for each id):
${JSON.stringify(pillars, null, 2)}`;
}
var OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    pillars: {
      type: "array",
      items: {
        type: "object",
        properties: { id: { type: "string" }, text: { type: "string" } },
        required: ["id", "text"],
        additionalProperties: false
      }
    }
  },
  required: ["pillars"],
  additionalProperties: false
};
async function generateRationaleLLM(assessment, opts) {
  const grounding = buildGrounding(assessment);
  if (grounding.length === 0) {
    return { patientId: assessment.patientId, pillars: [], generatedAt: (/* @__PURE__ */ new Date()).toISOString() };
  }
  const client = new Anthropic({ apiKey: opts.apiKey });
  const message = await client.messages.create({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    output_config: { format: { type: "json_schema", schema: OUTPUT_SCHEMA } },
    messages: [{ role: "user", content: groundingToPrompt(assessment, grounding) }]
  });
  const text = (message.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "").join("").trim();
  const parsed = JSON.parse(text);
  const byId = new Map((parsed.pillars ?? []).map((p) => [p.id, p.text ?? ""]));
  return {
    patientId: assessment.patientId,
    generatedAt: (/* @__PURE__ */ new Date()).toISOString(),
    pillars: grounding.map((g) => {
      const llmText = byId.get(g.pillar.id)?.trim();
      if (llmText) {
        return {
          pillarId: g.pillar.id,
          label: g.pillar.label,
          status: g.pillar.status,
          text: llmText,
          citations: uniqueCitations(g.chunks),
          source: "llm"
        };
      }
      return renderNoLlm(g);
    })
  };
}
async function generateRationale(assessment, opts = {}) {
  if (!opts.apiKey) return renderDeterministicRationale(assessment);
  try {
    return await generateRationaleLLM(assessment, { apiKey: opts.apiKey, model: opts.model });
  } catch {
    return renderDeterministicRationale(assessment);
  }
}

// api-src/rationale.ts
var API_KEY = process.env.ANTHROPIC_API_KEY || void 0;
var MODEL = process.env.ANTHROPIC_MODEL || void 0;
function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}
var rationale_default = {
  async fetch(req) {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    try {
      const body = await req.json().catch(() => ({}));
      const assessment = body.assessment;
      if (!assessment || !Array.isArray(assessment.pillars)) {
        return json({ error: "expected { assessment: GdmtAssessment }" }, 400);
      }
      const result = await generateRationale(assessment, { apiKey: API_KEY, model: MODEL });
      const mode = result.pillars.some((p) => p.source === "llm") ? "llm" : result.pillars.some((p) => p.source === "prebaked") ? "prebaked" : "deterministic";
      return json({ ...result, mode, llmConfigured: Boolean(API_KEY) });
    } catch (e) {
      console.error("[rationale] error", e);
      return json({ error: e instanceof Error ? e.message : "error" }, 500);
    }
  }
};
export {
  rationale_default as default
};
