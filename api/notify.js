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
var ALERT_THRESHOLDS = {
  // Fluid-retention / decompensation (HFSA self-care guidance).
  weightGain1dKg: 0.9,
  // ~2 lb overnight
  weightGain7dKg: 2.3,
  // ~5 lb in a week
  weightWindow1dDays: 1.5,
  // tolerance window for an "overnight" comparison
  weightWindow7dDays: 7,
  // Titration-safety vitals (GDMT initiation/up-titration limits).
  sbpMinAlert: 90,
  // symptomatic hypotension limits ARNI/ACEi/ARB & SGLT2i
  hrMinAlert: 50,
  // bradycardia limits beta-blocker
  hrMaxAlert: 100,
  // sustained resting tachycardia
  // General red flag (cite cautiously — not HF-specific).
  spo2MinAlert: 90,
  // Ignore readings older than this for alerting (days).
  vitalAlertRecencyDays: 14,
  // --- Predictive / trend rules (early warning BEFORE a hard threshold breach) ---
  // Rising-weight trend: a run of N consecutive increasing daily readings whose total
  // gain is meaningful but still under the acute 7-day threshold → early heads-up.
  weightRisingRun: 3,
  // consecutive increasing readings (>=3 points)
  weightRisingMinTotalKg: 0.6,
  // cumulative gain across the run to flag (below weightGain7dKg)
  // Declining-SpO2 trend: relative % drop across a short window while still >= the acute
  // floor — catches a downward slide before it crosses 90%.
  spo2DeclinePct: 4,
  // relative % decline over the window
  spo2DeclineWindowDays: 3
};

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
function weightKg(obs) {
  const q = obs.valueQuantity;
  if (typeof q?.value !== "number") return void 0;
  const unit = (q.unit ?? "").toLowerCase();
  if (unit.includes("lb") || unit === "[lb_av]") return q.value * 0.453592;
  return q.value;
}
function buildAlertInput(opts) {
  const obs = resources(opts.observations).filter((r) => r.resourceType === "Observation");
  const weightSeriesKg = obs.filter((o) => hasLoinc(o, LOINC.BODY_WEIGHT)).map((o) => ({ value: weightKg(o), date: obsDate(o) })).filter((r) => typeof r.value === "number" && typeof r.date === "string").sort((a, b) => a.date.localeCompare(b.date));
  const latest = (set) => obs.filter((o) => hasLoinc(o, set)).sort((a, b) => (obsDate(b) ?? "").localeCompare(obsDate(a) ?? ""))[0];
  const sbpObs = latest(LOINC.SBP);
  const hrObs = latest(LOINC.HEART_RATE);
  const spo2Obs = latest(LOINC.SPO2);
  const spo2SeriesPct = obs.filter((o) => hasLoinc(o, LOINC.SPO2)).map((o) => ({ value: obsValue(o), date: obsDate(o) })).filter((r) => typeof r.value === "number" && typeof r.date === "string").sort((a, b) => a.date.localeCompare(b.date));
  return {
    patientId: opts.patientId,
    now: opts.now ?? (/* @__PURE__ */ new Date()).toISOString(),
    weightSeriesKg,
    systolicBp: dated(sbpObs ? obsValue(sbpObs) : void 0, sbpObs ? obsDate(sbpObs) : void 0),
    heartRate: dated(hrObs ? obsValue(hrObs) : void 0, hrObs ? obsDate(hrObs) : void 0),
    spo2: dated(spo2Obs ? obsValue(spo2Obs) : void 0, spo2Obs ? obsDate(spo2Obs) : void 0),
    spo2SeriesPct
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

// src/engine/alerts.ts
var DAY_MS = 24 * 60 * 60 * 1e3;
function ageInDays(now, date) {
  const d = new Date(date).getTime();
  const n = new Date(now).getTime();
  if (Number.isNaN(d) || Number.isNaN(n)) return void 0;
  return Math.max(0, (n - d) / DAY_MS);
}
function freshVital(now, m) {
  if (!m || m.date === void 0) return void 0;
  const age = ageInDays(now, m.date);
  if (age === void 0 || age > ALERT_THRESHOLDS.vitalAlertRecencyDays) return void 0;
  return { value: m.value, date: m.date };
}
function round1(n) {
  return Math.round(n * 10) / 10;
}
function kgToLb(kg) {
  return round1(kg / 0.453592);
}
function weightGainAlert(series, now, opts) {
  if (series.length < 2) return void 0;
  const sorted = [...series].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latest = sorted[sorted.length - 1];
  if (!latest) return void 0;
  const latestAge = ageInDays(now, latest.date);
  if (latestAge === void 0 || latestAge > ALERT_THRESHOLDS.vitalAlertRecencyDays) return void 0;
  const latestTime = new Date(latest.date).getTime();
  const windowStart = latestTime - opts.windowDays * DAY_MS;
  const baseline = sorted.find((r) => new Date(r.date).getTime() >= windowStart && r !== latest);
  if (!baseline) return void 0;
  const gainKg = round1(latest.value - baseline.value);
  if (gainKg < opts.thresholdKg) return void 0;
  return {
    id: opts.id,
    severity: opts.severity,
    kind: "threshold",
    vital: "weight",
    title: "Possible fluid retention \u2014 weight gain",
    detail: `Weight rose ${gainKg} kg (${kgToLb(gainKg)} lb) over ${round1(opts.windowDays)} day(s) \u2014 at or above the ${opts.thresholdKg} kg (${kgToLb(opts.thresholdKg)} lb) threshold for possible HF decompensation. Consider clinical review.`,
    observed: `+${gainKg} kg over ${round1(opts.windowDays)} day(s)`,
    threshold: `\u2265 ${opts.thresholdKg} kg / ${round1(opts.windowDays)} day(s)`,
    citationRef: "HFSA-selfcare-weight-monitoring",
    triggeredBy: [baseline, latest]
  };
}
function weightRisingTrendAlert(series, now) {
  if (series.length < ALERT_THRESHOLDS.weightRisingRun) return void 0;
  const sorted = [...series].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latest = sorted[sorted.length - 1];
  if (!latest) return void 0;
  const latestAge = ageInDays(now, latest.date);
  if (latestAge === void 0 || latestAge > ALERT_THRESHOLDS.vitalAlertRecencyDays) return void 0;
  let runStart = sorted.length - 1;
  while (runStart > 0 && sorted[runStart].value > sorted[runStart - 1].value) runStart--;
  const run = sorted.slice(runStart);
  if (run.length < ALERT_THRESHOLDS.weightRisingRun) return void 0;
  const totalGain = round1(latest.value - run[0].value);
  if (totalGain < ALERT_THRESHOLDS.weightRisingMinTotalKg || totalGain >= ALERT_THRESHOLDS.weightGain7dKg) return void 0;
  return {
    id: "weight-trend-rising",
    severity: "moderate",
    kind: "trend",
    vital: "weight",
    title: "Upward weight trend \u2014 watch for fluid retention",
    detail: `Weight has risen for ${run.length} consecutive readings (+${totalGain} kg / ${kgToLb(totalGain)} lb so far), below the acute ${ALERT_THRESHOLDS.weightGain7dKg} kg threshold. Early sign of possible fluid accumulation \u2014 monitor closely.`,
    observed: `+${totalGain} kg over ${run.length} readings`,
    threshold: `rising run \u2265 ${ALERT_THRESHOLDS.weightRisingRun}, < ${ALERT_THRESHOLDS.weightGain7dKg} kg acute`,
    citationRef: "HFSA-selfcare-weight-monitoring",
    triggeredBy: [run[0], latest]
  };
}
function spo2DeclineTrendAlert(series, now) {
  if (series.length < 2) return void 0;
  const sorted = [...series].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const latest = sorted[sorted.length - 1];
  if (!latest) return void 0;
  const latestAge = ageInDays(now, latest.date);
  if (latestAge === void 0 || latestAge > ALERT_THRESHOLDS.vitalAlertRecencyDays) return void 0;
  if (latest.value < ALERT_THRESHOLDS.spo2MinAlert) return void 0;
  const windowStart = new Date(latest.date).getTime() - ALERT_THRESHOLDS.spo2DeclineWindowDays * DAY_MS;
  const baseline = sorted.find((r) => new Date(r.date).getTime() >= windowStart && r !== latest);
  if (!baseline || baseline.value === 0) return void 0;
  const declinePct = round1((baseline.value - latest.value) / baseline.value * 100);
  if (declinePct < ALERT_THRESHOLDS.spo2DeclinePct) return void 0;
  return {
    id: "spo2-trend-decline",
    severity: "moderate",
    kind: "trend",
    vital: "spo2",
    title: "Declining oxygen saturation trend",
    detail: `SpO\u2082 fell ${declinePct}% (from ${baseline.value}% to ${latest.value}%) over ${ALERT_THRESHOLDS.spo2DeclineWindowDays} day(s), still above the ${ALERT_THRESHOLDS.spo2MinAlert}% floor. Downward trend \u2014 review before it crosses the threshold.`,
    observed: `${declinePct}% drop (\u2192 ${latest.value}%)`,
    threshold: `\u2265 ${ALERT_THRESHOLDS.spo2DeclinePct}% over ${ALERT_THRESHOLDS.spo2DeclineWindowDays} day(s)`,
    citationRef: "general-red-flag-spo2",
    triggeredBy: [baseline, latest]
  };
}
function evaluateAlerts(input) {
  const alerts = [];
  const series = input.weightSeriesKg ?? [];
  const week = weightGainAlert(series, input.now, {
    id: "weight-gain-7d",
    windowDays: ALERT_THRESHOLDS.weightWindow7dDays,
    thresholdKg: ALERT_THRESHOLDS.weightGain7dKg,
    severity: "high"
  });
  const overnight = weightGainAlert(series, input.now, {
    id: "weight-gain-1d",
    windowDays: ALERT_THRESHOLDS.weightWindow1dDays,
    thresholdKg: ALERT_THRESHOLDS.weightGain1dKg,
    severity: "moderate"
  });
  if (week) alerts.push(week);
  if (overnight) alerts.push(overnight);
  if (!week && !overnight) {
    const rising = weightRisingTrendAlert(series, input.now);
    if (rising) alerts.push(rising);
  }
  const sbp = freshVital(input.now, input.systolicBp);
  if (sbp && sbp.value < ALERT_THRESHOLDS.sbpMinAlert) {
    alerts.push({
      id: "hypotension",
      severity: "moderate",
      kind: "threshold",
      vital: "bloodPressure",
      title: "Low blood pressure \u2014 titration-limiting",
      detail: `Systolic BP ${sbp.value} mmHg is below ${ALERT_THRESHOLDS.sbpMinAlert} mmHg. May limit ARNI/ACEi/ARB and SGLT2i initiation or up-titration; check for symptoms.`,
      observed: `${sbp.value} mmHg`,
      threshold: `< ${ALERT_THRESHOLDS.sbpMinAlert} mmHg`,
      citationRef: "AHA-ACC-HFSA-2022-7.3.1",
      triggeredBy: [sbp]
    });
  }
  const hr = freshVital(input.now, input.heartRate);
  if (hr && hr.value < ALERT_THRESHOLDS.hrMinAlert) {
    alerts.push({
      id: "bradycardia",
      severity: "moderate",
      kind: "threshold",
      vital: "heartRate",
      title: "Bradycardia \u2014 beta-blocker-limiting",
      detail: `Heart rate ${hr.value} bpm is below ${ALERT_THRESHOLDS.hrMinAlert} bpm, which limits beta-blocker initiation or up-titration.`,
      observed: `${hr.value} bpm`,
      threshold: `< ${ALERT_THRESHOLDS.hrMinAlert} bpm`,
      citationRef: "AHA-ACC-HFSA-2022-7.3.2",
      triggeredBy: [hr]
    });
  } else if (hr && hr.value > ALERT_THRESHOLDS.hrMaxAlert) {
    alerts.push({
      id: "tachycardia",
      severity: "low",
      kind: "threshold",
      vital: "heartRate",
      title: "Resting tachycardia",
      detail: `Resting heart rate ${hr.value} bpm is above ${ALERT_THRESHOLDS.hrMaxAlert} bpm.`,
      observed: `${hr.value} bpm`,
      threshold: `> ${ALERT_THRESHOLDS.hrMaxAlert} bpm`,
      citationRef: "AHA-ACC-HFSA-2022-7.3.2",
      triggeredBy: [hr]
    });
  }
  const spo2 = freshVital(input.now, input.spo2);
  if (spo2 && spo2.value < ALERT_THRESHOLDS.spo2MinAlert) {
    alerts.push({
      id: "hypoxia",
      severity: "high",
      kind: "threshold",
      vital: "spo2",
      title: "Low oxygen saturation",
      detail: `SpO\u2082 ${spo2.value}% is below ${ALERT_THRESHOLDS.spo2MinAlert}%.`,
      observed: `${spo2.value}%`,
      threshold: `< ${ALERT_THRESHOLDS.spo2MinAlert}%`,
      citationRef: "general-red-flag-spo2",
      triggeredBy: [spo2]
    });
  } else {
    const decline = spo2DeclineTrendAlert(input.spo2SeriesPct ?? [], input.now);
    if (decline) alerts.push(decline);
  }
  return alerts;
}

// src/engine/rules.ts
var DAY_MS2 = 24 * 60 * 60 * 1e3;

// src/fhir/writeback.ts
var ALERT_IDENTIFIER_SYSTEM = "urn:hf-gdmt:alert";
function alertKey(patientRef, alert) {
  const patientId = patientRef.replace(/^Patient\//, "");
  const last = alert.triggeredBy[alert.triggeredBy.length - 1];
  return `${patientId}:${alert.id}:${last?.date ?? ""}`;
}
function alertEvidenceText(alert) {
  return alert.triggeredBy.map((r) => `${r.value} @ ${r.date}`).join("; ");
}
function alertIdentifier(patientRef, alert, suffix) {
  return [{ system: ALERT_IDENTIFIER_SYSTEM, value: `${alertKey(patientRef, alert)}:${suffix}` }];
}
function buildDetectedIssue(alert, opts) {
  const observationRefs = opts.observationRefs ?? (opts.focusObservationRef ? [opts.focusObservationRef] : []);
  return {
    resourceType: "DetectedIssue",
    identifier: alertIdentifier(opts.patientRef, alert, "issue"),
    status: "final",
    severity: alert.severity,
    // high | moderate | low — maps 1:1 to FHIR
    code: { text: alert.title },
    patient: { reference: opts.patientRef },
    identifiedDateTime: (/* @__PURE__ */ new Date()).toISOString(),
    detail: `${alert.detail} (Source: ${alert.citationRef}) [readings: ${alertEvidenceText(alert)}]`,
    ...observationRefs.length ? { evidence: observationRefs.map((ref) => ({ detail: [{ reference: ref }] })) } : {}
  };
}
function buildFlagForAlert(alert, opts) {
  return {
    resourceType: "Flag",
    identifier: alertIdentifier(opts.patientRef, alert, "flag"),
    status: "active",
    category: [{ text: "Heart failure remote monitoring" }],
    code: { text: alert.title },
    subject: { reference: opts.patientRef },
    period: { start: (/* @__PURE__ */ new Date()).toISOString() }
  };
}
function buildTaskForAlert(alert, opts) {
  const priority = alert.severity === "high" ? "urgent" : alert.severity === "moderate" ? "asap" : "routine";
  return {
    resourceType: "Task",
    identifier: alertIdentifier(opts.patientRef, alert, "task"),
    status: opts.taskStatus ?? "requested",
    intent: "order",
    priority,
    description: `Review HF alert: ${alert.title}`,
    code: { text: `HF remote-monitoring alert: ${alert.vital}` },
    for: { reference: opts.patientRef },
    authoredOn: (/* @__PURE__ */ new Date()).toISOString(),
    // Link the Task to the Observation that triggered the alert (provenance/mapping).
    ...opts.focusObservationRef ? { focus: { reference: opts.focusObservationRef } } : {},
    ...opts.requesterRef ? { requester: { reference: opts.requesterRef } } : {},
    ...opts.ownerDisplay ? { owner: { display: opts.ownerDisplay } } : {},
    note: [{ text: `${alert.detail} (Source: ${alert.citationRef})` }]
  };
}

// server/alertService.ts
function patientIdFromNotification(body) {
  const b = body;
  if (!b || typeof b !== "object") return null;
  if (typeof b.patientId === "string") return b.patientId;
  const subjectRef = (r) => {
    const ref = r?.subject?.reference;
    return typeof ref === "string" && ref.startsWith("Patient/") ? ref.slice("Patient/".length) : null;
  };
  if (b.resourceType === "Observation") return subjectRef(b);
  if (b.resourceType === "Bundle") {
    const entries = b.entry ?? [];
    for (const e of entries) {
      if (e.resource?.resourceType === "Observation") {
        const id = subjectRef(e.resource);
        if (id) return id;
      }
    }
  }
  return null;
}
async function processNotification(body, deps) {
  const patientId = patientIdFromNotification(body);
  if (!patientId) return { patientId: null, alerts: [], created: [] };
  const observations = await deps.readObservations(patientId);
  const input = buildAlertInput({ patientId, observations, now: deps.now?.() });
  const alerts = evaluateAlerts(input);
  const opts = { patientRef: `Patient/${patientId}` };
  const created = [];
  for (const alert of alerts) {
    const [di, flag, task] = await Promise.all([
      deps.createResource(buildDetectedIssue(alert, opts)),
      deps.createResource(buildFlagForAlert(alert, opts)),
      deps.createResource(buildTaskForAlert(alert, opts))
    ]);
    created.push({ detectedIssueId: di.id, flagId: flag.id, taskId: task.id });
  }
  return { patientId, alerts, created };
}
function identifierSearchToken(resource) {
  const ids = resource.identifier;
  const first = ids?.[0];
  if (!first?.value) return null;
  return first.system ? `${first.system}|${first.value}` : first.value;
}
function createFhirDeps(config) {
  const readBase = config.readBase.replace(/\/$/, "");
  const writeBase = (config.writeBase || config.readBase).replace(/\/$/, "");
  const authHeader = config.token ? { Authorization: `Bearer ${config.token}` } : {};
  return {
    readObservations: async (patientId) => {
      const res = await fetch(`${readBase}/Observation?patient=${patientId}&_count=200&_sort=-date`, {
        headers: { Accept: "application/fhir+json", ...authHeader }
      });
      if (!res.ok) throw new Error(`read Observations \u2192 ${res.status}`);
      return res.json();
    },
    // Idempotent create: the alert builders carry a stable identifier, so a repeated
    // Subscription notification for the same alert must not spawn duplicate artifacts.
    // Search-then-create (not the If-None-Exist header) mirrors the SPA's approach and
    // avoids the header being stripped by some servers/CORS.
    createResource: async (resource) => {
      const token = identifierSearchToken(resource);
      if (token) {
        const search = await fetch(
          `${writeBase}/${resource.resourceType}?identifier=${encodeURIComponent(token)}`,
          { headers: { Accept: "application/fhir+json", ...authHeader } }
        );
        if (search.ok) {
          const bundle = await search.json();
          const existing = bundle.entry?.[0]?.resource;
          if (existing?.id) return { id: existing.id };
        }
      }
      const res = await fetch(`${writeBase}/${resource.resourceType}`, {
        method: "POST",
        headers: { "Content-Type": "application/fhir+json", Accept: "application/fhir+json", ...authHeader },
        body: JSON.stringify(resource)
      });
      if (!res.ok) throw new Error(`create ${resource.resourceType} \u2192 ${res.status}`);
      return res.json();
    }
  };
}

// api-src/notify.ts
var FHIR_BASE = (process.env.MEDBLOCKS_FHIR_BASE || "https://hapi.fhir.org/baseR4").replace(/\/$/, "");
var TOKEN = process.env.MEDBLOCKS_TOKEN || void 0;
var fhirDeps = createFhirDeps({ readBase: FHIR_BASE, token: TOKEN });
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}
var notify_default = {
  async fetch(req) {
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    try {
      const url = new URL(req.url);
      let body = await req.json().catch(() => ({}));
      const pid = url.searchParams.get("patient");
      if (pid && (!body || typeof body !== "object" || !Object.keys(body).length)) {
        body = { patientId: pid };
      }
      const result = await processNotification(body, fhirDeps);
      console.log(`[notify] patient=${result.patientId} alerts=${result.alerts.length} written=${result.created.length}`);
      return json(result);
    } catch (e) {
      console.error("[notify] error", e);
      return json({ error: e instanceof Error ? e.message : "error" }, 500);
    }
  }
};
export {
  notify_default as default
};
