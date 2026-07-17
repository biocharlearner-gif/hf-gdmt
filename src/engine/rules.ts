import type { Dated, EngineInput, MedicationFact, PillarId, PillarResult, PillarStatus } from "./types";
import { TARGET_DOSE_MG, THRESHOLDS, isArni } from "./codes";

const DAY_MS = 24 * 60 * 60 * 1000;

function ageInDays(now: string, date?: string): number | undefined {
  if (!date) return undefined;
  const d = new Date(date).getTime();
  const n = new Date(now).getTime();
  if (Number.isNaN(d) || Number.isNaN(n)) return undefined;
  return Math.max(0, Math.round((n - d) / DAY_MS));
}

/** Returns the value only if present and within the recency window. */
function fresh<T>(now: string, m: Dated<T> | undefined, maxDays: number): T | undefined {
  if (!m) return undefined;
  const age = ageInDays(now, m.date);
  if (age === undefined) return m.value; // no date -> accept but caller may note
  return age <= maxDays ? m.value : undefined;
}

function activeAgentFor(input: EngineInput, pillar: PillarId): MedicationFact | undefined {
  return input.medications.find((m) => m.active && m.pillar === pillar);
}

function targetDoseFor(name: string): number | undefined {
  const n = name.toLowerCase();
  for (const [drug, dose] of Object.entries(TARGET_DOSE_MG)) {
    if (n.includes(drug)) return dose;
  }
  return undefined;
}

/** Classify dose adequacy for an agent the patient is already on. */
function doseStatus(agent: MedicationFact): {
  status: PillarStatus;
  targetDoseMg?: number;
  doseFraction?: number;
} {
  const targetDoseMg = targetDoseFor(agent.name);
  if (agent.dailyDoseMg === undefined || targetDoseMg === undefined) {
    // On therapy but dose adequacy unknown -> treat conservatively as sub-target.
    return { status: "ON_SUBTARGET", targetDoseMg };
  }
  const doseFraction = agent.dailyDoseMg / targetDoseMg;
  return {
    status: doseFraction >= THRESHOLDS.onTargetFraction ? "ON_TARGET" : "ON_SUBTARGET",
    targetDoseMg,
    doseFraction: Math.round(doseFraction * 100) / 100,
  };
}

interface PillarConfig {
  id: PillarId;
  label: string;
  citationRef: string;
  /** Evaluate eligibility for a patient NOT currently on this pillar. */
  evaluateGap: (input: EngineInput) => Pick<PillarResult, "status" | "reason" | "gating" | "suggestedAction">;
}

const PILLARS: PillarConfig[] = [
  {
    id: "RAASi",
    label: "RAAS inhibition (ARNI preferred / ACEi / ARB)",
    citationRef: "AHA-ACC-HFSA-2022-7.3.1",
    evaluateGap: (input) => {
      const k = fresh(input.now, input.labs.potassium, THRESHOLDS.labRecencyDays);
      const egfr = fresh(input.now, input.labs.egfr, THRESHOLDS.labRecencyDays);
      const sbp = fresh(input.now, input.vitals.systolicBp, THRESHOLDS.vitalRecencyDays);
      const gating = { potassium: k, egfr, systolicBp: sbp };

      if (input.flags.angioedemaHistory)
        return { status: "CONTRAINDICATED", reason: "History of angioedema — avoid ARNI/ACEi.", gating };
      if (input.flags.pregnancy)
        return { status: "CONTRAINDICATED", reason: "Pregnancy — RAAS inhibitors contraindicated.", gating };
      if (k !== undefined && k > THRESHOLDS.potassiumHoldRaasi)
        return { status: "CONTRAINDICATED", reason: `Hyperkalemia (K+ ${k}) > ${THRESHOLDS.potassiumHoldRaasi}.`, gating };
      if (k === undefined || egfr === undefined)
        return { status: "GAP_LABS_NEEDED", reason: "Recent K+ and eGFR required before initiation.", gating,
                 suggestedAction: { kind: "ORDER_LABS", text: "Order BMP (K+, eGFR) before starting RAAS inhibitor" } };
      if (egfr < THRESHOLDS.egfrMinRaasi)
        return { status: "CONTRAINDICATED", reason: `eGFR ${egfr} < ${THRESHOLDS.egfrMinRaasi} — defer initiation.`, gating };
      if (sbp !== undefined && sbp < THRESHOLDS.sbpMinAcearb)
        return { status: "CONTRAINDICATED", reason: `SBP ${sbp} < ${THRESHOLDS.sbpMinAcearb} — hypotensive.`, gating };
      return {
        status: "GAP_ELIGIBLE",
        reason: `Eligible: K+ ${k} (<=${THRESHOLDS.potassiumHoldRaasi}), eGFR ${egfr} (>=${THRESHOLDS.egfrMinRaasi}). ARNI preferred.`,
        gating,
        suggestedAction: { kind: "INITIATE", text: "Initiate ARNI (sacubitril/valsartan); 36h washout if switching from ACEi" },
      };
    },
  },
  {
    id: "BetaBlocker",
    label: "Evidence-based beta-blocker",
    citationRef: "AHA-ACC-HFSA-2022-7.3.2",
    evaluateGap: (input) => {
      const hr = fresh(input.now, input.vitals.heartRate, THRESHOLDS.vitalRecencyDays);
      const sbp = fresh(input.now, input.vitals.systolicBp, THRESHOLDS.vitalRecencyDays);
      const gating = { heartRate: hr, systolicBp: sbp };
      if (hr === undefined)
        return { status: "GAP_LABS_NEEDED", reason: "Recent heart rate required before initiation/titration.", gating,
                 suggestedAction: { kind: "ORDER_LABS", text: "Record heart rate / vitals before starting beta-blocker" } };
      if (hr < THRESHOLDS.hrMinBetaBlocker)
        return { status: "CONTRAINDICATED", reason: `HR ${hr} < ${THRESHOLDS.hrMinBetaBlocker} — bradycardia, defer.`, gating };
      if (sbp !== undefined && sbp < THRESHOLDS.sbpMinBetaBlocker)
        return { status: "CONTRAINDICATED", reason: `SBP ${sbp} < ${THRESHOLDS.sbpMinBetaBlocker} — hypotensive.`, gating };
      return { status: "GAP_ELIGIBLE", reason: `Eligible: HR ${hr} (>=${THRESHOLDS.hrMinBetaBlocker}). Use carvedilol / metoprolol succinate / bisoprolol.`, gating,
               suggestedAction: { kind: "INITIATE", text: "Initiate evidence-based beta-blocker; up-titrate as tolerated" } };
    },
  },
  {
    id: "MRA",
    label: "Mineralocorticoid receptor antagonist",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3",
    evaluateGap: (input) => {
      const k = fresh(input.now, input.labs.potassium, THRESHOLDS.labRecencyDays);
      const egfr = fresh(input.now, input.labs.egfr, THRESHOLDS.labRecencyDays);
      const gating = { potassium: k, egfr };
      if (k === undefined || egfr === undefined)
        return { status: "GAP_LABS_NEEDED", reason: "Recent K+ and eGFR required before initiation.", gating,
                 suggestedAction: { kind: "ORDER_LABS", text: "Order BMP (K+, eGFR) before starting MRA" } };
      if (k > THRESHOLDS.potassiumHoldMra)
        return { status: "CONTRAINDICATED", reason: `K+ ${k} > ${THRESHOLDS.potassiumHoldMra} — avoid MRA.`, gating };
      if (egfr < THRESHOLDS.egfrMinMra)
        return { status: "CONTRAINDICATED", reason: `eGFR ${egfr} < ${THRESHOLDS.egfrMinMra} — avoid MRA.`, gating };
      return { status: "GAP_ELIGIBLE", reason: `Eligible: K+ ${k} (<=${THRESHOLDS.potassiumHoldMra}), eGFR ${egfr} (>=${THRESHOLDS.egfrMinMra}).`, gating,
               suggestedAction: { kind: "INITIATE", text: "Initiate spironolactone or eplerenone; recheck K+ in 1–2 weeks" } };
    },
  },
  {
    id: "SGLT2i",
    label: "SGLT2 inhibitor",
    citationRef: "AHA-ACC-HFSA-2022-7.3.4",
    evaluateGap: (input) => {
      const egfr = fresh(input.now, input.labs.egfr, THRESHOLDS.labRecencyDays);
      const gating = { egfr };
      if (input.flags.type1Diabetes)
        return { status: "CONTRAINDICATED", reason: "Type 1 diabetes — DKA risk, avoid.", gating };
      if (egfr === undefined)
        return { status: "GAP_LABS_NEEDED", reason: "Recent eGFR required before initiation.", gating,
                 suggestedAction: { kind: "ORDER_LABS", text: "Order eGFR before starting SGLT2 inhibitor" } };
      if (egfr < THRESHOLDS.egfrMinSglt2i)
        return { status: "CONTRAINDICATED", reason: `eGFR ${egfr} < ${THRESHOLDS.egfrMinSglt2i} — below initiation threshold.`, gating };
      return { status: "GAP_ELIGIBLE", reason: `Eligible: eGFR ${egfr} (>=${THRESHOLDS.egfrMinSglt2i}). Benefit regardless of diabetes status.`, gating,
               suggestedAction: { kind: "INITIATE", text: "Initiate dapagliflozin or empagliflozin 10 mg daily" } };
    },
  },
];

export function evaluatePillar(input: EngineInput, cfg: PillarConfig = PILLARS[0]!): PillarResult {
  const agent = activeAgentFor(input, cfg.id);
  if (agent) {
    const ds = doseStatus(agent);
    const onTarget = ds.status === "ON_TARGET";
    const suggestedAction = onTarget
      ? undefined
      : ({ kind: "UPTITRATE", text: `Up-titrate ${agent.name} toward target dose` } as const);
    // Time-on-therapy: sub-target pillars sitting below target past the titration
    // interval are overdue for up-titration (guideline §7.3, ~2-week intervals).
    const daysOnTherapy = ageInDays(input.now, agent.startedOn);
    const titration = agent.startedOn !== undefined && daysOnTherapy !== undefined
      ? {
          startedOn: agent.startedOn,
          daysOnTherapy,
          intervalDays: THRESHOLDS.titrationIntervalDays,
          overdue: ds.status === "ON_SUBTARGET" && daysOnTherapy > THRESHOLDS.titrationIntervalDays,
        }
      : undefined;
    return {
      id: cfg.id,
      label: cfg.label,
      status: ds.status,
      agent: { name: agent.name, dailyDoseMg: agent.dailyDoseMg, targetDoseMg: ds.targetDoseMg, doseFraction: ds.doseFraction, startedOn: agent.startedOn },
      titration,
      reason: onTarget
        ? `On ${agent.name} at target dose.`
        : `On ${agent.name}${agent.dailyDoseMg ? ` (${agent.dailyDoseMg} mg/day)` : ""} below target${ds.targetDoseMg ? ` (${ds.targetDoseMg} mg/day)` : ""}.`,
      gating: {},
      citationRef: cfg.citationRef,
      suggestedAction,
    };
  }
  const gap = cfg.evaluateGap(input);
  return { id: cfg.id, label: cfg.label, citationRef: cfg.citationRef, ...gap };
}

export { PILLARS, isArni };
