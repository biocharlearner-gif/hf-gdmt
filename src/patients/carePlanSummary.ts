import type { GdmtAssessment, PillarResult } from "../engine/engine";
import { isApplicablePillar } from "../engine/engine";
import { resolveCitation } from "../engine/citations";
import type { projectBenefit } from "../engine/benefit";
import { fullName, mrnOf, formatDobLong, ageFromIso, type FhirPatient } from "./patientMapper";

/**
 * Build a self-contained, printable Heart-Failure GDMT care summary as an HTML string.
 * Pure (no DOM, no network) so it is unit-testable; the Care Plan tab opens the result in
 * a new window and calls window.print(). The engine decides every value shown here — this
 * only formats the assessment into a clinician/patient handout. Not a prescription.
 */

const STATUS_LABEL: Record<PillarResult["status"], string> = {
  ON_TARGET: "On target",
  ON_SUBTARGET: "On — sub-target",
  GAP_ELIGIBLE: "Gap — eligible",
  GAP_LABS_NEEDED: "Labs needed",
  CONTRAINDICATED: "Contraindicated",
  INSUFFICIENT_DATA: "Insufficient data",
};

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]!));
}

function doseText(p: PillarResult): string {
  const a = p.agent;
  if (!a) return "—";
  if (a.dailyDoseMg && a.targetDoseMg) return `${a.name} · ${a.dailyDoseMg} / ${a.targetDoseMg} mg/day`;
  return a.name;
}

export function carePlanSummaryHtml(input: {
  patient: FhirPatient;
  assessment: GdmtAssessment;
  benefit?: ReturnType<typeof projectBenefit> | null;
  generatedBy?: string;
}): string {
  const { patient, assessment, benefit, generatedBy } = input;
  const applicable = assessment.pillars.filter((p) => isApplicablePillar(assessment.phenotype, p.id));
  const eligibleGaps = applicable.filter((p) => p.status === "GAP_ELIGIBLE").length;
  const age = ageFromIso(patient.birthDate);
  const generatedOn = new Date().toLocaleString(undefined, { dateStyle: "long", timeStyle: "short" });
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const goals = [
    "Achieve target-dose GDMT across all eligible pillars",
    ...(eligibleGaps > 0 ? [`Close ${eligibleGaps} eligible GDMT gap(s) now`] : []),
  ];

  const rows = applicable
    .map(
      (p) => `
      <tr>
        <td>${esc(p.label)}</td>
        <td>${esc(doseText(p))}</td>
        <td>${esc(STATUS_LABEL[p.status])}</td>
        <td>${esc(p.suggestedAction?.text ?? p.reason)}</td>
      </tr>`,
    )
    .join("");

  // Unique guideline citations across the applicable pillars.
  const citeRefs = [...new Set(applicable.map((p) => p.citationRef))];
  const citations = citeRefs
    .map((ref) => {
      const c = resolveCitation(ref);
      return `<li>${esc(c.source)}${c.section ? ` — ${esc(c.section)}` : ""}</li>`;
    })
    .join("");

  const benefitBlock = benefit
    ? `<div class="benefit">
        <div><span class="big">${pct(benefit.currentRRR)}</span><br/>Current therapy</div>
        <div><span class="big">${pct(benefit.potentialRRR)}</span><br/>If eligible gaps closed</div>
        <div><span class="big">+${pct(benefit.incrementalRRR)}</span><br/>Additional available now</div>
      </div>`
    : "";

  return `<!doctype html><html><head><meta charset="utf-8"/>
<title>GDMT Care Summary — ${esc(fullName(patient))}</title>
<style>
  * { box-sizing: border-box; }
  body { font: 14px/1.5 -apple-system, Segoe UI, Roboto, Helvetica, Arial, sans-serif; color: #0f172a; margin: 32px; }
  h1 { font-size: 20px; margin: 0 0 2px; }
  h2 { font-size: 14px; text-transform: uppercase; letter-spacing: .5px; color: #475569; margin: 24px 0 8px; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
  .sub { color: #64748b; font-size: 12px; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; margin-top: 8px; }
  table { width: 100%; border-collapse: collapse; margin-top: 4px; }
  th, td { text-align: left; padding: 6px 8px; border-bottom: 1px solid #e2e8f0; vertical-align: top; font-size: 13px; }
  th { color: #475569; font-size: 11px; text-transform: uppercase; letter-spacing: .4px; }
  ul { margin: 4px 0; padding-left: 20px; }
  .benefit { display: flex; gap: 16px; margin-top: 8px; }
  .benefit > div { flex: 1; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; padding: 12px; text-align: center; font-size: 12px; color: #475569; }
  .benefit .big { font-size: 22px; font-weight: 800; color: #0f172a; }
  .disclaimer { margin-top: 24px; padding: 10px 12px; background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 12px; color: #475569; }
  @media print { body { margin: 0; } button { display: none; } }
</style></head>
<body>
  <h1>Heart Failure GDMT — Care Summary</h1>
  <div class="sub">Generated ${esc(generatedOn)}${generatedBy ? ` · ${esc(generatedBy)}` : ""}</div>

  <h2>Patient</h2>
  <div class="grid">
    <div><strong>${esc(fullName(patient))}</strong></div>
    <div>MRN: ${esc(mrnOf(patient) ?? "—")}</div>
    <div>DOB: ${esc(formatDobLong(patient.birthDate))}${age !== null ? ` (age ${age})` : ""}</div>
    <div style="text-transform:capitalize">Gender: ${esc(patient.gender ?? "—")}</div>
  </div>

  <h2>Heart failure phenotype</h2>
  <div>${esc(assessment.phenotype)}${assessment.lvef !== undefined ? ` · LVEF ${esc(assessment.lvef)}%` : ""} —
    GDMT score ${esc(assessment.gdmtScore)}/4, ${Math.round(assessment.optimizationPct * 100)}% of eligible pillars at target.</div>

  <h2>Goals</h2>
  <ul>${goals.map((g) => `<li>${esc(g)}</li>`).join("")}</ul>

  <h2>Guideline-directed therapy — four pillars</h2>
  <table>
    <thead><tr><th>Pillar</th><th>Medication / dose</th><th>Status</th><th>Next step</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>

  ${benefit ? `<h2>Projected benefit (relative risk reduction)</h2>${benefitBlock}
  <div class="sub" style="margin-top:6px">Illustrative composite (CV death / HF hospitalization) RRR from the pivotal HFrEF trials — directional only, not a patient-specific prediction.</div>` : ""}

  <h2>Guideline sources</h2>
  <ul>${citations}</ul>

  <div class="disclaimer"><strong>Decision support, not a prescription.</strong> Every status is computed
  deterministically from coded rules (LVEF, labs, vitals, contraindications) with a guideline citation.
  A clinician reviews and accepts each action; this summary does not itself order therapy.</div>
</body></html>`;
}
