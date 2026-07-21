// src/engine/codes.ts
var LOINC = {
  LVEF: ["10230-1", "8806-2"],
  EGFR: ["33914-3", "62238-1", "48642-3", "48643-1"],
  CREATININE: ["2160-0"],
  POTASSIUM: ["2823-3"],
  NT_PROBNP: ["33762-6"],
  BNP: ["30934-4"],
  SBP: ["8480-6"],
  DBP: ["8462-4"],
  HEART_RATE: ["8867-4"],
  BODY_WEIGHT: ["29463-7", "3141-9", "8350-1"],
  // measured / stated body weight
  SPO2: ["59408-5", "2708-6"]
  // SpO2 by pulse ox / oxygen saturation
};
var SNOMED = {
  HEART_FAILURE: "84114007",
  HFREF: "703272007"
};
var PILLAR_INGREDIENTS = {
  RAASi: [
    // ARNI (preferred)
    "sacubitril",
    "sacubitril/valsartan",
    "sacubitril / valsartan",
    "entresto",
    // ACE inhibitors
    "lisinopril",
    "enalapril",
    "ramipril",
    "captopril",
    "perindopril",
    "trandolapril",
    "fosinopril",
    // ARBs
    "losartan",
    "valsartan",
    "candesartan",
    "irbesartan",
    "olmesartan",
    "telmisartan"
  ],
  BetaBlocker: [
    // evidence-based beta-blockers for HFrEF
    "carvedilol",
    "metoprolol succinate",
    "metoprolol",
    "bisoprolol"
  ],
  MRA: ["spironolactone", "eplerenone"],
  SGLT2i: ["dapagliflozin", "empagliflozin", "sotagliflozin", "canagliflozin"]
};
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
var THRESHOLDS = {
  hfrefLvefMax: 40,
  hfmrefLvefMax: 49,
  potassiumHoldMra: 5,
  // hold MRA if K+ > this
  potassiumHoldRaasi: 5.5,
  // hold RAASi if K+ > this
  egfrMinMra: 30,
  egfrMinRaasi: 30,
  egfrMinSglt2i: 20,
  sbpMinRaasi: 100,
  // ARNI initiation preference
  sbpMinAcearb: 90,
  sbpMinBetaBlocker: 90,
  hrMinBetaBlocker: 60,
  // recency windows (days)
  labRecencyDays: 90,
  vitalRecencyDays: 90,
  lvefRecencyDays: 365,
  // dose-adequacy: >= this fraction of target counts as ON_TARGET
  onTargetFraction: 0.9,
  // Up-titrate a sub-target pillar if it has sat below target longer than this (days).
  titrationIntervalDays: 14,
  // Post-HF-hospitalization "vulnerable phase": highest risk of readmission (days
  // since discharge). Beyond hfHospRecentDays the admission stops driving current risk.
  hfHospVulnerableDays: 30,
  hfHospRecentDays: 90
};
function classifyMed(name) {
  const n = name.toLowerCase().trim();
  for (const [pillar, names] of Object.entries(PILLAR_INGREDIENTS)) {
    if (names.some((drug) => n.includes(drug))) return pillar;
  }
  return null;
}

// src/engine/rules.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
function ageInDays(now, date) {
  if (!date) return void 0;
  const d = new Date(date).getTime();
  const n = new Date(now).getTime();
  if (Number.isNaN(d) || Number.isNaN(n)) return void 0;
  return Math.max(0, Math.round((n - d) / DAY_MS));
}
function fresh(now, m, maxDays) {
  if (!m) return void 0;
  const age = ageInDays(now, m.date);
  if (age === void 0) return m.value;
  return age <= maxDays ? m.value : void 0;
}
function activeAgentFor(input, pillar) {
  return input.medications.find((m) => m.active && m.pillar === pillar);
}
function targetDoseFor(name) {
  const n = name.toLowerCase();
  for (const [drug, dose] of Object.entries(TARGET_DOSE_MG)) {
    if (n.includes(drug)) return dose;
  }
  return void 0;
}
function doseStatus(agent) {
  const targetDoseMg = targetDoseFor(agent.name);
  if (agent.dailyDoseMg === void 0 || targetDoseMg === void 0) {
    return { status: "ON_SUBTARGET", targetDoseMg };
  }
  const doseFraction = agent.dailyDoseMg / targetDoseMg;
  return {
    status: doseFraction >= THRESHOLDS.onTargetFraction ? "ON_TARGET" : "ON_SUBTARGET",
    targetDoseMg,
    doseFraction: Math.round(doseFraction * 100) / 100
  };
}
var PILLARS = [
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
        return { status: "CONTRAINDICATED", reason: "History of angioedema \u2014 avoid ARNI/ACEi.", gating };
      if (input.flags.pregnancy)
        return { status: "CONTRAINDICATED", reason: "Pregnancy \u2014 RAAS inhibitors contraindicated.", gating };
      if (k !== void 0 && k > THRESHOLDS.potassiumHoldRaasi)
        return { status: "CONTRAINDICATED", reason: `Hyperkalemia (K+ ${k}) > ${THRESHOLDS.potassiumHoldRaasi}.`, gating };
      if (k === void 0 || egfr === void 0)
        return {
          status: "GAP_LABS_NEEDED",
          reason: "Recent K+ and eGFR required before initiation.",
          gating,
          suggestedAction: { kind: "ORDER_LABS", text: "Order BMP (K+, eGFR) before starting RAAS inhibitor" }
        };
      if (egfr < THRESHOLDS.egfrMinRaasi)
        return { status: "CONTRAINDICATED", reason: `eGFR ${egfr} < ${THRESHOLDS.egfrMinRaasi} \u2014 defer initiation.`, gating };
      if (sbp !== void 0 && sbp < THRESHOLDS.sbpMinAcearb)
        return { status: "CONTRAINDICATED", reason: `SBP ${sbp} < ${THRESHOLDS.sbpMinAcearb} \u2014 hypotensive.`, gating };
      return {
        status: "GAP_ELIGIBLE",
        reason: `Eligible: K+ ${k} (<=${THRESHOLDS.potassiumHoldRaasi}), eGFR ${egfr} (>=${THRESHOLDS.egfrMinRaasi}). ARNI preferred.`,
        gating,
        suggestedAction: { kind: "INITIATE", text: "Initiate ARNI (sacubitril/valsartan); 36h washout if switching from ACEi" }
      };
    }
  },
  {
    id: "BetaBlocker",
    label: "Evidence-based beta-blocker",
    citationRef: "AHA-ACC-HFSA-2022-7.3.2",
    evaluateGap: (input) => {
      const hr = fresh(input.now, input.vitals.heartRate, THRESHOLDS.vitalRecencyDays);
      const sbp = fresh(input.now, input.vitals.systolicBp, THRESHOLDS.vitalRecencyDays);
      const gating = { heartRate: hr, systolicBp: sbp };
      if (hr === void 0)
        return {
          status: "GAP_LABS_NEEDED",
          reason: "Recent heart rate required before initiation/titration.",
          gating,
          suggestedAction: { kind: "ORDER_LABS", text: "Record heart rate / vitals before starting beta-blocker" }
        };
      if (hr < THRESHOLDS.hrMinBetaBlocker)
        return { status: "CONTRAINDICATED", reason: `HR ${hr} < ${THRESHOLDS.hrMinBetaBlocker} \u2014 bradycardia, defer.`, gating };
      if (sbp !== void 0 && sbp < THRESHOLDS.sbpMinBetaBlocker)
        return { status: "CONTRAINDICATED", reason: `SBP ${sbp} < ${THRESHOLDS.sbpMinBetaBlocker} \u2014 hypotensive.`, gating };
      return {
        status: "GAP_ELIGIBLE",
        reason: `Eligible: HR ${hr} (>=${THRESHOLDS.hrMinBetaBlocker}). Use carvedilol / metoprolol succinate / bisoprolol.`,
        gating,
        suggestedAction: { kind: "INITIATE", text: "Initiate evidence-based beta-blocker; up-titrate as tolerated" }
      };
    }
  },
  {
    id: "MRA",
    label: "Mineralocorticoid receptor antagonist",
    citationRef: "AHA-ACC-HFSA-2022-7.3.3",
    evaluateGap: (input) => {
      const k = fresh(input.now, input.labs.potassium, THRESHOLDS.labRecencyDays);
      const egfr = fresh(input.now, input.labs.egfr, THRESHOLDS.labRecencyDays);
      const gating = { potassium: k, egfr };
      if (k === void 0 || egfr === void 0)
        return {
          status: "GAP_LABS_NEEDED",
          reason: "Recent K+ and eGFR required before initiation.",
          gating,
          suggestedAction: { kind: "ORDER_LABS", text: "Order BMP (K+, eGFR) before starting MRA" }
        };
      if (k > THRESHOLDS.potassiumHoldMra)
        return { status: "CONTRAINDICATED", reason: `K+ ${k} > ${THRESHOLDS.potassiumHoldMra} \u2014 avoid MRA.`, gating };
      if (egfr < THRESHOLDS.egfrMinMra)
        return { status: "CONTRAINDICATED", reason: `eGFR ${egfr} < ${THRESHOLDS.egfrMinMra} \u2014 avoid MRA.`, gating };
      return {
        status: "GAP_ELIGIBLE",
        reason: `Eligible: K+ ${k} (<=${THRESHOLDS.potassiumHoldMra}), eGFR ${egfr} (>=${THRESHOLDS.egfrMinMra}).`,
        gating,
        suggestedAction: { kind: "INITIATE", text: "Initiate spironolactone or eplerenone; recheck K+ in 1\u20132 weeks" }
      };
    }
  },
  {
    id: "SGLT2i",
    label: "SGLT2 inhibitor",
    citationRef: "AHA-ACC-HFSA-2022-7.3.4",
    evaluateGap: (input) => {
      const egfr = fresh(input.now, input.labs.egfr, THRESHOLDS.labRecencyDays);
      const gating = { egfr };
      if (input.flags.type1Diabetes)
        return { status: "CONTRAINDICATED", reason: "Type 1 diabetes \u2014 DKA risk, avoid.", gating };
      if (egfr === void 0)
        return {
          status: "GAP_LABS_NEEDED",
          reason: "Recent eGFR required before initiation.",
          gating,
          suggestedAction: { kind: "ORDER_LABS", text: "Order eGFR before starting SGLT2 inhibitor" }
        };
      if (egfr < THRESHOLDS.egfrMinSglt2i)
        return { status: "CONTRAINDICATED", reason: `eGFR ${egfr} < ${THRESHOLDS.egfrMinSglt2i} \u2014 below initiation threshold.`, gating };
      return {
        status: "GAP_ELIGIBLE",
        reason: `Eligible: eGFR ${egfr} (>=${THRESHOLDS.egfrMinSglt2i}). Benefit regardless of diabetes status.`,
        gating,
        suggestedAction: { kind: "INITIATE", text: "Initiate dapagliflozin or empagliflozin 10 mg daily" }
      };
    }
  }
];
function evaluatePillar(input, cfg = PILLARS[0]) {
  const agent = activeAgentFor(input, cfg.id);
  if (agent) {
    const ds = doseStatus(agent);
    const onTarget = ds.status === "ON_TARGET";
    const suggestedAction = onTarget ? void 0 : { kind: "UPTITRATE", text: `Up-titrate ${agent.name} toward target dose` };
    const daysOnTherapy = ageInDays(input.now, agent.startedOn);
    const titration = agent.startedOn !== void 0 && daysOnTherapy !== void 0 ? {
      startedOn: agent.startedOn,
      daysOnTherapy,
      intervalDays: THRESHOLDS.titrationIntervalDays,
      overdue: ds.status === "ON_SUBTARGET" && daysOnTherapy > THRESHOLDS.titrationIntervalDays
    } : void 0;
    return {
      id: cfg.id,
      label: cfg.label,
      status: ds.status,
      agent: { name: agent.name, dailyDoseMg: agent.dailyDoseMg, targetDoseMg: ds.targetDoseMg, doseFraction: ds.doseFraction, startedOn: agent.startedOn },
      titration,
      reason: onTarget ? `On ${agent.name} at target dose.` : `On ${agent.name}${agent.dailyDoseMg ? ` (${agent.dailyDoseMg} mg/day)` : ""} below target${ds.targetDoseMg ? ` (${ds.targetDoseMg} mg/day)` : ""}.`,
      gating: {},
      citationRef: cfg.citationRef,
      suggestedAction
    };
  }
  const gap = cfg.evaluateGap(input);
  return { id: cfg.id, label: cfg.label, citationRef: cfg.citationRef, ...gap };
}

// src/engine/engine.ts
function determinePhenotype(lvef) {
  if (lvef === void 0) return "Unknown";
  if (lvef <= THRESHOLDS.hfrefLvefMax) return "HFrEF";
  if (lvef <= THRESHOLDS.hfmrefLvefMax) return "HFmrEF";
  return "HFpEF";
}
var ON_STATUSES = /* @__PURE__ */ new Set(["ON_TARGET", "ON_SUBTARGET"]);
function evaluateGdmt(input) {
  const phenotype = determinePhenotype(input.lvef?.value);
  const pillars = PILLARS.map((cfg) => evaluatePillar(input, cfg));
  const gdmtScore = pillars.filter((p) => ON_STATUSES.has(p.status)).length;
  const optimizablePillars = pillars.filter(
    (p) => ON_STATUSES.has(p.status) || p.status === "GAP_ELIGIBLE"
  );
  const atTarget = pillars.filter((p) => p.status === "ON_TARGET").length;
  const optimizationPct = optimizablePillars.length === 0 ? 0 : Math.round(atTarget / optimizablePillars.length * 100) / 100;
  const labsNeeded = pillars.filter((p) => p.status === "GAP_LABS_NEEDED").map((p) => p.suggestedAction?.text ?? `Labs needed for ${p.label}`);
  return {
    patientId: input.patientId,
    phenotype,
    lvef: input.lvef?.value,
    gdmtScore,
    optimizationPct,
    pillars,
    labsNeeded: [...new Set(labsNeeded)],
    generatedAt: input.now
  };
}

// src/engine/benefit.ts
var PILLAR_RRR = {
  RAASi: 0.2,
  BetaBlocker: 0.34,
  MRA: 0.3,
  SGLT2i: 0.26
};
var ON = /* @__PURE__ */ new Set(["ON_TARGET", "ON_SUBTARGET"]);
function combinedRRR(rrrs) {
  const remaining = rrrs.reduce((acc, r) => acc * (1 - r), 1);
  return Math.round((1 - remaining) * 100) / 100;
}
function projectBenefit(a) {
  const onNow = a.pillars.filter((p) => ON.has(p.status)).map((p) => p.id);
  const eligibleGaps = a.pillars.filter((p) => p.status === "GAP_ELIGIBLE").map((p) => p.id);
  const currentRRR = combinedRRR(onNow.map((id) => PILLAR_RRR[id]));
  const potentialRRR = combinedRRR([...onNow, ...eligibleGaps].map((id) => PILLAR_RRR[id]));
  return {
    currentRRR,
    potentialRRR,
    incrementalRRR: Math.round((potentialRRR - currentRRR) * 100) / 100,
    closeableGaps: eligibleGaps
  };
}

// src/fhir/extract.ts
function codesOf(cc) {
  return (cc?.coding ?? []).map((c) => c.code ?? "").filter(Boolean);
}
function hasLoinc(obs, set) {
  return codesOf(obs.code).some((c) => set.includes(c));
}
function obsValue(obs) {
  const q = obs.valueQuantity;
  return typeof q?.value === "number" ? q.value : void 0;
}
function obsDate(obs) {
  return obs.effectiveDateTime ?? obs.effectiveInstant ?? obs.issued ?? void 0;
}
function dated(value, date) {
  return value === void 0 ? void 0 : { value, date };
}
function resources(bundleOrArray) {
  if (Array.isArray(bundleOrArray)) return bundleOrArray;
  return (bundleOrArray.entry ?? []).map((e) => e.resource).filter(Boolean);
}
function parseDailyDoseMg(mr) {
  const di = mr.dosageInstruction?.[0];
  const dose = di?.doseAndRate?.[0]?.doseQuantity;
  const perDay = di?.timing?.repeat?.frequency && di?.timing?.repeat?.period === 1 ? di.timing.repeat.frequency : 1;
  if (typeof dose?.value === "number" && (dose.unit ?? "").toLowerCase().includes("mg")) {
    return dose.value * perDay;
  }
  return void 0;
}
function isOnTherapy(status) {
  return status === "active" || status === "on-hold";
}
function buildEngineInput(opts) {
  const obs = resources(opts.observations).filter((r) => r.resourceType === "Observation");
  const meds = resources(opts.medications).filter(
    (r) => r.resourceType === "MedicationRequest" || r.resourceType === "MedicationStatement"
  );
  const allergies = resources(opts.allergies ?? []).filter((r) => r.resourceType === "AllergyIntolerance");
  const latest = (set) => obs.filter((o) => hasLoinc(o, set)).sort((a, b) => (obsDate(b) ?? "").localeCompare(obsDate(a) ?? ""))[0];
  const lvefObs = latest(LOINC.LVEF);
  const kObs = latest(LOINC.POTASSIUM);
  const egfrObs = latest(LOINC.EGFR);
  const crObs = latest(LOINC.CREATININE);
  const sbpObs = latest(LOINC.SBP);
  const hrObs = latest(LOINC.HEART_RATE);
  const medications = meds.map((m) => {
    const name = m.medicationCodeableConcept?.text ?? m.medicationCodeableConcept?.coding?.[0]?.display ?? "unknown";
    const rxnorm = (m.medicationCodeableConcept?.coding ?? []).find(
      (c) => (c.system ?? "").includes("rxnorm")
    )?.code;
    const status = m.status ?? "active";
    return {
      name,
      rxnorm,
      pillar: classifyMed(name),
      dailyDoseMg: parseDailyDoseMg(m),
      active: isOnTherapy(status),
      startedOn: typeof m.authoredOn === "string" ? m.authoredOn : void 0
    };
  });
  const angioedemaHistory = allergies.some(
    (a) => JSON.stringify(a).toLowerCase().includes("angioedema")
  );
  return {
    patientId: opts.patientId,
    now: opts.now ?? (/* @__PURE__ */ new Date()).toISOString(),
    lvef: dated(lvefObs ? obsValue(lvefObs) : void 0, lvefObs ? obsDate(lvefObs) : void 0),
    medications,
    labs: {
      potassium: dated(kObs ? obsValue(kObs) : void 0, kObs ? obsDate(kObs) : void 0),
      egfr: dated(egfrObs ? obsValue(egfrObs) : void 0, egfrObs ? obsDate(egfrObs) : void 0),
      creatinine: dated(crObs ? obsValue(crObs) : void 0, crObs ? obsDate(crObs) : void 0)
    },
    vitals: {
      systolicBp: dated(sbpObs ? obsValue(sbpObs) : void 0, sbpObs ? obsDate(sbpObs) : void 0),
      heartRate: dated(hrObs ? obsValue(hrObs) : void 0, hrObs ? obsDate(hrObs) : void 0)
    },
    flags: { angioedemaHistory }
  };
}
var HF_ENCOUNTER_SNOMED = /* @__PURE__ */ new Set([
  SNOMED.HEART_FAILURE,
  SNOMED.HFREF,
  "42343007",
  // Congestive heart failure
  "88805009",
  // Chronic congestive heart failure
  "56675007"
  // Acute heart failure
]);

// src/cds/service.ts
var SERVICE_ID = "hf-gdmt-optimizer";
function handlePatientView(req, opts) {
  const pf = req.prefetch ?? {};
  const input = buildEngineInput({
    patientId: req.context.patientId,
    observations: pf.observations ?? { entry: [] },
    medications: pf.medications ?? { entry: [] },
    conditions: pf.conditions
  });
  const a = evaluateGdmt(input);
  const eligibleGaps = a.pillars.filter((p) => p.status === "GAP_ELIGIBLE");
  if (a.phenotype !== "HFrEF" || eligibleGaps.length === 0 && a.gdmtScore === 4) {
    return { cards: [] };
  }
  const benefit = projectBenefit(a);
  const gapList = eligibleGaps.map((p) => `- **${p.label}** \u2014 ${p.reason} _(Source: ${p.citationRef})_`).join("\n");
  const base = opts.smartAppUrl.replace(/\/$/, "");
  const launchUrl = `${base}/launch`;
  return {
    cards: [
      {
        uuid: crypto.randomUUID(),
        summary: `HF below target GDMT: ${a.gdmtScore} of 4 pillars`,
        indicator: a.gdmtScore <= 2 ? "warning" : "info",
        detail: `LVEF ${a.lvef ?? "?"}% (HFrEF). Closing eligible gaps adds ~${Math.round(benefit.incrementalRRR * 100)}% relative reduction in CV death / HF hospitalization (illustrative).

${gapList}`,
        source: { label: "HF GDMT Optimizer", url: opts.smartAppUrl },
        links: [
          { label: "Open GDMT Optimizer", url: launchUrl, type: "smart" }
        ]
      }
    ]
  };
}

// api-src/cds-card.ts
var SMART_APP_URL = process.env.SMART_APP_URL || "http://localhost:5173";
var CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...CORS }
  });
}
var cds_card_default = {
  async fetch(req) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const url = new URL(req.url);
    const service = url.pathname.split("/").pop();
    if (service !== SERVICE_ID) return json({ error: "unknown service" }, 404);
    const body = await req.json().catch(() => ({}));
    return json(handlePatientView(body, { smartAppUrl: SMART_APP_URL }));
  }
};
export {
  cds_card_default as default
};
