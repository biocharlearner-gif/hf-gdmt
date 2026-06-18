import { evaluateGdmt } from "../engine/engine";
import { projectBenefit } from "../engine/benefit";
import { buildEngineInput } from "../fhir/extract";

/**
 * CDS Hooks service (feature C1) — framework-agnostic handlers. Wire these into
 * Express/Fastify/Hono. The same engine that powers the SPA powers the card, so
 * the logic is written once.
 *
 *   GET  /cds-services                         -> discovery (return discovery())
 *   POST /cds-services/hf-gdmt-optimizer       -> patient-view (return handlePatientView(req.body))
 */

const SERVICE_ID = "hf-gdmt-optimizer";

export function discovery() {
  return {
    services: [
      {
        hook: "patient-view",
        id: SERVICE_ID,
        title: "HF GDMT Optimizer",
        description: "Flags heart-failure patients below guideline-directed medical therapy and links to the optimizer.",
        prefetch: {
          patient: "Patient/{{context.patientId}}",
          conditions: "Condition?patient={{context.patientId}}",
          medications: "MedicationRequest?patient={{context.patientId}}",
          observations: "Observation?patient={{context.patientId}}&_sort=-date",
        },
      },
    ],
  };
}

export interface CdsRequest {
  hook: string;
  context: { patientId: string; userId?: string };
  prefetch?: {
    patient?: any;
    conditions?: any;
    medications?: any;
    observations?: any;
  };
  /** Where the SMART app is hosted, for the launch link. */
}

export function handlePatientView(req: CdsRequest, opts: { smartAppUrl: string }) {
  const pf = req.prefetch ?? {};
  // prefetch values arrive as Bundles; buildEngineInput accepts Bundles directly.
  const input = buildEngineInput({
    patientId: req.context.patientId,
    observations: pf.observations ?? { entry: [] },
    medications: pf.medications ?? { entry: [] },
    conditions: pf.conditions,
  });

  const a = evaluateGdmt(input);

  // Only surface a card when there is something actionable for an HFrEF patient.
  const eligibleGaps = a.pillars.filter((p) => p.status === "GAP_ELIGIBLE");
  if (a.phenotype !== "HFrEF" || (eligibleGaps.length === 0 && a.gdmtScore === 4)) {
    return { cards: [] };
  }

  const benefit = projectBenefit(a);
  const gapList = eligibleGaps.map((p) => `- **${p.label}** — ${p.reason} _(Source: ${p.citationRef})_`).join("\n");

  const launchUrl = `${opts.smartAppUrl}?patient=${encodeURIComponent(req.context.patientId)}`;

  return {
    cards: [
      {
        uuid: crypto.randomUUID(),
        summary: `HF below target GDMT: ${a.gdmtScore} of 4 pillars`,
        indicator: a.gdmtScore <= 2 ? "warning" : "info",
        detail:
          `LVEF ${a.lvef ?? "?"}% (HFrEF). Closing eligible gaps adds ~${Math.round(benefit.incrementalRRR * 100)}% ` +
          `relative reduction in CV death / HF hospitalization (illustrative).\n\n${gapList}`,
        source: { label: "HF GDMT Optimizer", url: opts.smartAppUrl },
        links: [
          { label: "Open GDMT Optimizer", url: launchUrl, type: "smart" },
        ],
      },
    ],
  };
}

export { SERVICE_ID };
