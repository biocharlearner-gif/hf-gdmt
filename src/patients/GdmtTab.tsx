import { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  LinearProgress,
  Paper,
  Typography,
} from "@mui/material";
import MonitorHeartIcon from "@mui/icons-material/MonitorHeartOutlined";
import ScienceIcon from "@mui/icons-material/ScienceOutlined";
import TrendingUpIcon from "@mui/icons-material/TrendingUp";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import { getObservations, getMedications, getConditions, getTasksForPatient, createResource, createResourceIfNoneExist, type FhirResource } from "./patientApi";
import { buildEngineInput } from "../fhir/extract";
import { evaluateGdmt, gdmtStage, isApplicablePillar, type GdmtAssessment, type GdmtStage, type PillarResult, type PillarStatus, type PillarId, type Phenotype } from "../engine/engine";
import { projectBenefit } from "../engine/benefit";
import { buildTaskForGap, buildLabServiceRequest, buildCarePlan } from "../fhir/writeback";
import { DEMO_TAG } from "./fhirConfig";
import { CURRENT_USER } from "./currentUser";
import { fmtDay } from "./format";
import CitationLine from "./CitationLine";

/**
 * GDMT tab — the flagship assessment. Fetches the patient's Observations / Conditions /
 * Medications, feeds the PURE `evaluateGdmt` engine (which decides), and renders the
 * result: phenotype gate (Gate 2, LVEF), the four-pillar panel with per-pillar status,
 * dose adequacy, contraindication reasons + guideline citations, a benefit projection,
 * and loop-closure writeback (Task per gap → GDMT CarePlan). The engine decides; this
 * component only displays and offers the writes — it never picks a drug or dose.
 */

const GDMT_IDENTIFIER_SYSTEM = "urn:hf-gdmt:gdmt";

/** Stable identifier value for a pillar's gap Task — the key that makes creation idempotent. */
const taskIdValue = (patientId: string, pillar: PillarId) => `${patientId}:${pillar}:task`;

/** Map the patient's existing Tasks back to the pillars they were created for. */
function pillarTaskIds(patientId: string, tasks: FhirResource[]): Record<string, string> {
  const byPillar: Record<string, string> = {};
  for (const t of tasks) {
    if (!t.id) continue;
    const identifiers = (t.identifier as { system?: string; value?: string }[] | undefined) ?? [];
    for (const idf of identifiers) {
      if (idf.system !== GDMT_IDENTIFIER_SYSTEM || !idf.value) continue;
      const pillar = idf.value.startsWith(`${patientId}:`) && idf.value.endsWith(":task")
        ? idf.value.slice(patientId.length + 1, -":task".length)
        : undefined;
      if (pillar) byPillar[pillar] = String(t.id);
    }
  }
  return byPillar;
}

const STATUS_META: Record<PillarStatus, { label: string; bg: string; fg: string }> = {
  ON_TARGET: { label: "On target", bg: "#dcfce7", fg: "#15803d" },
  ON_SUBTARGET: { label: "On — sub-target", bg: "#fef9c3", fg: "#854d0e" },
  GAP_ELIGIBLE: { label: "Gap — eligible", bg: "#fee2e2", fg: "#b91c1c" },
  GAP_LABS_NEEDED: { label: "Labs needed", bg: "#e0eaff", fg: "#3056d3" },
  CONTRAINDICATED: { label: "Contraindicated", bg: "#f1f5f9", fg: "#475569" },
  INSUFFICIENT_DATA: { label: "Insufficient data", bg: "#f1f5f9", fg: "#475569" },
};

const TASK_STATUSES = new Set<PillarStatus>(["GAP_ELIGIBLE", "ON_SUBTARGET"]);

interface ActionState {
  status: "idle" | "busy" | "done" | "error";
  msg?: string;
}
const IDLE: ActionState = { status: "idle" };

export default function GdmtTab() {
  const { id = "" } = useParams();
  const patientId = id;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assessment, setAssessment] = useState<GdmtAssessment | null>(null);
  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [taskRefs, setTaskRefs] = useState<string[]>([]);
  /** pillar id → id of the Task that already exists on the server for that gap. */
  const [existingTasks, setExistingTasks] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getObservations(patientId),
      getMedications(patientId),
      getConditions(patientId),
      getTasksForPatient(patientId).catch(() => []),
    ])
      .then(([observations, medications, conditions, tasks]) => {
        const input = buildEngineInput({
          patientId,
          now: new Date().toISOString(),
          observations,
          medications,
          conditions,
        });
        setAssessment(evaluateGdmt(input));
        const byPillar = pillarTaskIds(patientId, tasks);
        setExistingTasks(byPillar);
        setTaskRefs(Object.values(byPillar).map((tid) => `Task/${tid}`));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load GDMT assessment"))
      .finally(() => setLoading(false));
  }, [patientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const setAction = (key: string, s: ActionState) => setActions((prev) => ({ ...prev, [key]: s }));

  const patientRef = `Patient/${patientId}`;
  const tagged = <T extends Record<string, unknown>>(r: T, idValue: string): FhirResource =>
    ({ ...r, meta: { tag: [{ ...DEMO_TAG }] }, identifier: [{ system: GDMT_IDENTIFIER_SYSTEM, value: idValue }] } as unknown as FhirResource);

  async function createTask(pillar: PillarResult) {
    const key = pillar.id;
    setAction(key, { status: "busy" });
    try {
      const idValue = taskIdValue(patientId, pillar.id);
      const resource = tagged(
        buildTaskForGap(pillar, { patientRef, requesterRef: undefined, conditionRef: undefined }),
        idValue,
      );
      // Owner = the accepting clinician; keep the loop-closure story consistent with alerts.
      (resource as Record<string, unknown>).owner = { display: CURRENT_USER.display };
      const created = await createResourceIfNoneExist(resource, `identifier=${GDMT_IDENTIFIER_SYSTEM}|${idValue}`);
      if (created.id) {
        setTaskRefs((prev) => [...new Set([...prev, `Task/${created.id}`])]);
        setExistingTasks((prev) => ({ ...prev, [pillar.id]: String(created.id) }));
      }
      setAction(key, { status: "done", msg: `FHIR Task created (${created.id ?? "existing"})` });
    } catch (e) {
      setAction(key, { status: "error", msg: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function orderLabs(pillar: PillarResult) {
    const key = `labs:${pillar.id}`;
    setAction(key, { status: "busy" });
    try {
      const idValue = `${patientId}:bmp`;
      const resource = tagged(buildLabServiceRequest({ patientRef }), idValue);
      const created = await createResourceIfNoneExist(resource, `identifier=${GDMT_IDENTIFIER_SYSTEM}|${idValue}`);
      setAction(key, { status: "done", msg: `Lab order created (${created.id ?? "existing"})` });
    } catch (e) {
      setAction(key, { status: "error", msg: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function orderEcho() {
    setAction("echo", { status: "busy" });
    try {
      const idValue = `${patientId}:echo`;
      const resource = tagged(
        {
          resourceType: "ServiceRequest",
          status: "active",
          intent: "order",
          priority: "routine",
          code: {
            coding: [{ system: "http://loinc.org", code: "34552-0", display: "Echocardiography study" }],
            text: "Transthoracic echocardiogram to determine LVEF / HF phenotype",
          },
          subject: { reference: patientRef },
          authoredOn: new Date().toISOString(),
          requester: { display: CURRENT_USER.display },
          note: [{ text: "LVEF unknown — determine phenotype before initiating the four-pillar GDMT program. (Source: 2022 AHA/ACC/HFSA HF Guideline)" }],
        },
        idValue,
      );
      const created = await createResourceIfNoneExist(resource, `identifier=${GDMT_IDENTIFIER_SYSTEM}|${idValue}`);
      setAction("echo", { status: "done", msg: `Echo order created (${created.id ?? "existing"})` });
    } catch (e) {
      setAction("echo", { status: "error", msg: e instanceof Error ? e.message : "Failed" });
    }
  }

  async function generateCarePlan() {
    if (!assessment) return;
    setAction("careplan", { status: "busy" });
    try {
      const idValue = `${patientId}:careplan`;
      const resource = tagged(buildCarePlan(assessment, taskRefs, { patientRef }), idValue);
      const created = await createResource(resource);
      setAction("careplan", { status: "done", msg: `CarePlan created (${created.id ?? "?"})` });
    } catch (e) {
      setAction("careplan", { status: "error", msg: e instanceof Error ? e.message : "Failed" });
    }
  }

  const benefit = useMemo(() => (assessment ? projectBenefit(assessment) : null), [assessment]);
  const stage = useMemo(() => (assessment ? gdmtStage(assessment) : null), [assessment]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!assessment) return <Alert severity="warning">No assessment available.</Alert>;

  const { phenotype, lvef } = assessment;
  const isHfref = phenotype === "HFrEF";
  const isUnknown = phenotype === "Unknown";

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <PhenotypeBanner
        phenotype={phenotype}
        lvef={lvef}
        onOrderEcho={orderEcho}
        echoState={actions["echo"] ?? IDLE}
      />

      {/* "You are here" on the GDMT optimization journey. Skipped for Unknown, where the
          phenotype banner above already prompts an echo (would just duplicate it). */}
      {stage && !isUnknown && <StageBanner stage={stage} />}

      {isHfref && (
        // Score + benefit read as one story (where the patient is / what closing the gaps buys),
        // so they sit side by side rather than eating two full-width rows.
        <Box sx={{ display: "grid", gridTemplateColumns: benefit ? "minmax(260px, 1fr) 1.5fr" : "1fr", gap: 2 }}>
          <ScoreCard assessment={assessment} />
          {benefit && <BenefitCard benefit={benefit} />}
        </Box>
      )}

      <Box>
        <Typography variant="h6" sx={{ fontWeight: 700, mb: 1.5 }}>
          Guideline-directed medical therapy — four pillars
        </Typography>
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          {assessment.pillars.map((p) => (
            <PillarCard
              key={p.id}
              pillar={p}
              applicable={isApplicablePillar(phenotype, p.id)}
              phenotype={phenotype}
              patientId={patientId}
              existingTaskId={existingTasks[p.id]}
              taskState={actions[p.id] ?? IDLE}
              labState={actions[`labs:${p.id}`] ?? IDLE}
              onCreateTask={() => createTask(p)}
              onOrderLabs={() => orderLabs(p)}
            />
          ))}
        </Box>
      </Box>

      {!isUnknown && (
        <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <Box sx={{ flexGrow: 1, minWidth: 200 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Bundle into a GDMT CarePlan
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Groups the accepted gaps into one Heart Failure GDMT Optimization CarePlan (loop closure).
              {taskRefs.length > 0 ? ` ${taskRefs.length} Task(s) linked.` : ""}
            </Typography>
            {actions["careplan"]?.msg && (
              <Typography variant="caption" sx={{ color: actions["careplan"]?.status === "error" ? "error.main" : "success.main" }}>
                {actions["careplan"]?.msg}
              </Typography>
            )}
          </Box>
          <Button
            variant="contained"
            disabled={actions["careplan"]?.status === "busy" || actions["careplan"]?.status === "done"}
            onClick={generateCarePlan}
          >
            {actions["careplan"]?.status === "busy"
              ? "Generating…"
              : actions["careplan"]?.status === "done"
                ? "✓ CarePlan created"
                : "Generate GDMT CarePlan"}
          </Button>
        </Paper>
      )}

      <SafetyNote />
    </Box>
  );
}

// ---- Sub-components ----------------------------------------------------------

function PhenotypeBanner({
  phenotype,
  lvef,
  onOrderEcho,
  echoState,
}: {
  phenotype: Phenotype;
  lvef?: number;
  onOrderEcho: () => void;
  echoState: ActionState;
}) {
  const lvefText = lvef !== undefined ? `${lvef}%` : "unknown";
  const meta: Record<Phenotype, { tone: "success" | "info" | "warning"; text: string }> = {
    HFrEF: { tone: "success", text: "HFrEF (LVEF ≤ 40%) — the full four-pillar GDMT program applies." },
    HFmrEF: { tone: "info", text: "HFmrEF (LVEF 41–49%) — SGLT2 inhibitors have cross-spectrum benefit; the four-pillar program is established for HFrEF." },
    HFpEF: { tone: "info", text: "HFpEF (LVEF ≥ 50%) — SGLT2 inhibitors have cross-spectrum benefit; the four-pillar program is established for HFrEF." },
    Unknown: { tone: "warning", text: "LVEF unknown — determine phenotype (echocardiogram) before starting the four-pillar program. LVEF is the deciding factor, not the diagnosis code." },
  };
  const m = meta[phenotype];
  return (
    <Alert
      severity={m.tone}
      icon={<MonitorHeartIcon />}
      action={
        phenotype === "Unknown" ? (
          <Button
            color="inherit"
            size="small"
            variant="outlined"
            disabled={echoState.status === "busy" || echoState.status === "done"}
            onClick={onOrderEcho}
          >
            {echoState.status === "busy" ? "Ordering…" : echoState.status === "done" ? "✓ Echo ordered" : "Order echocardiogram"}
          </Button>
        ) : undefined
      }
    >
      <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
        Phenotype: {phenotype} · LVEF {lvefText}
      </Typography>
      <Typography variant="body2">{m.text}</Typography>
      {phenotype === "Unknown" && echoState.msg && (
        <Typography variant="caption" sx={{ color: echoState.status === "error" ? "error.main" : "success.main" }}>
          {echoState.msg}
        </Typography>
      )}
    </Alert>
  );
}

const STAGE_STEPS: { label: string }[] = [
  { label: "Initiation" },
  { label: "Active titration" },
  { label: "Optimized" },
];
/** Which of the three journey steps a stage maps to (OPTIMIZED_LIMITED shares the last). */
function stageStepIndex(id: GdmtStage["id"]): number {
  if (id === "INITIATION") return 0;
  if (id === "TITRATION") return 1;
  return 2; // OPTIMIZED, OPTIMIZED_LIMITED
}
const STAGE_TONE: Record<GdmtStage["tone"], { fg: string; bg: string; border: string }> = {
  info: { fg: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  warning: { fg: "#b45309", bg: "#fffbeb", border: "#fde68a" },
  success: { fg: "#15803d", bg: "#f0fdf4", border: "#bbf7d0" },
};

/**
 * "You are here" on the GDMT optimization journey — the stage a HF clinician actually
 * reasons in (initiation → active titration → optimized), computed deterministically by
 * the engine from the pillar statuses. Answers "which stage is this patient in?" without
 * any EHR visit-type data.
 */
function StageBanner({ stage }: { stage: GdmtStage }) {
  const active = stageStepIndex(stage.id);
  const tone = STAGE_TONE[stage.tone];
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5, borderColor: tone.border, bgcolor: tone.bg }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5, flexWrap: "wrap" }}>
        <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary", lineHeight: 1 }}>
          GDMT journey
        </Typography>
        <Chip size="small" label={stage.label} sx={{ bgcolor: tone.fg, color: "#fff", fontWeight: 700 }} />
        {stage.lastChangeDays !== undefined && (
          <Typography variant="caption" color="text.secondary">
            last change {stage.lastChangeDays}d ago
          </Typography>
        )}
      </Box>

      {/* Three-step progress rail */}
      <Box sx={{ display: "flex", alignItems: "center", mb: 1.5 }}>
        {STAGE_STEPS.map((s, i) => {
          const done = i < active;
          const current = i === active;
          const dotColor = done || current ? tone.fg : "#cbd5e1";
          return (
            <Box key={s.label} sx={{ display: "flex", alignItems: "center", flex: i < STAGE_STEPS.length - 1 ? 1 : "0 0 auto" }}>
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, flexShrink: 0 }}>
                <Box
                  sx={{
                    width: current ? 16 : 12,
                    height: current ? 16 : 12,
                    borderRadius: "50%",
                    bgcolor: dotColor,
                    boxShadow: current ? `0 0 0 4px ${tone.bg}, 0 0 0 5px ${tone.fg}` : "none",
                  }}
                />
                <Typography
                  variant="caption"
                  sx={{ fontWeight: current ? 700 : 500, color: current ? tone.fg : "text.secondary", whiteSpace: "nowrap" }}
                >
                  {s.label}
                </Typography>
              </Box>
              {i < STAGE_STEPS.length - 1 && (
                <Box sx={{ flex: 1, height: 2, mx: 1, mb: 2.5, bgcolor: i < active ? tone.fg : "#e2e8f0" }} />
              )}
            </Box>
          );
        })}
      </Box>

      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {stage.summary}
      </Typography>
      {stage.nextStep && (
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>
          Next: {stage.nextStep}
        </Typography>
      )}
    </Paper>
  );
}

function ScoreCard({ assessment }: { assessment: GdmtAssessment }) {
  const onCount = assessment.pillars.filter((p) => p.status === "ON_TARGET" || p.status === "ON_SUBTARGET").length;
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, height: "100%" }}>
      <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary", lineHeight: 1.6 }}>
        GDMT optimization
      </Typography>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 1, mt: 0.5 }}>
        <Typography variant="h3" sx={{ fontWeight: 800, lineHeight: 1, color: "primary.main" }}>
          {assessment.gdmtScore}
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
          / 4 pillars on therapy
        </Typography>
        <Typography variant="body2" sx={{ fontWeight: 700, ml: "auto" }}>
          {Math.round(assessment.optimizationPct * 100)}% at target
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={Math.round(assessment.optimizationPct * 100)}
        sx={{ height: 8, borderRadius: 4, my: 1 }}
      />
      <Typography variant="body2" color="text.secondary">
        {onCount} of 4 pillars started; {assessment.pillars.filter((p) => p.status === "GAP_ELIGIBLE").length} eligible gap(s) can be closed now.
      </Typography>
    </Paper>
  );
}

function BenefitCard({ benefit }: { benefit: ReturnType<typeof projectBenefit> }) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, height: "100%" }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 1 }}>
        <TrendingUpIcon color="primary" fontSize="small" />
        <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary", lineHeight: 1.6 }}>
          Projected benefit (relative risk reduction)
        </Typography>
      </Box>
      <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 1 }}>
        <Stat label="Current therapy" value={pct(benefit.currentRRR)} tone="muted" />
        <Stat label="If eligible gaps closed" value={pct(benefit.potentialRRR)} tone="good" />
        <Stat label="Additional available now" value={`+${pct(benefit.incrementalRRR)}`} tone="accent" />
      </Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ display: "block", mt: 1, fontSize: "0.68rem", lineHeight: 1.4 }}
      >
        Illustrative composite (CV death / HF hospitalization) RRR from the pivotal HFrEF trials
        (PARADIGM-HF, MERIT-HF/CIBIS-II/COPERNICUS, RALES/EMPHASIS-HF, DAPA-HF/EMPEROR-Reduced),
        combined multiplicatively. For directional illustration only — not a patient-specific prediction.
      </Typography>
    </Paper>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone: "muted" | "good" | "accent" }) {
  const color = tone === "good" ? "#15803d" : tone === "accent" ? "#b45309" : "text.primary";
  return (
    <Box sx={{ textAlign: "center", px: 1, py: 1.25, borderRadius: 2, bgcolor: "#f8fafc" }}>
      <Typography variant="h5" sx={{ fontWeight: 800, color, lineHeight: 1.2 }}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600, lineHeight: 1.3, display: "block" }}>
        {label}
      </Typography>
    </Box>
  );
}

function DoseBar({ pillar }: { pillar: PillarResult }) {
  const a = pillar.agent;
  if (!a?.dailyDoseMg || !a?.targetDoseMg) return null;
  const pct = Math.min(100, Math.round(((a.doseFraction ?? a.dailyDoseMg / a.targetDoseMg)) * 100));
  const atTarget = pillar.status === "ON_TARGET";
  return (
    <Box sx={{ mt: 1 }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.25 }}>
        <Typography variant="caption" color="text.secondary">
          {a.dailyDoseMg} mg/day of {a.targetDoseMg} mg/day target
        </Typography>
        <Typography variant="caption" sx={{ fontWeight: 700, color: atTarget ? "#15803d" : "#854d0e" }}>
          {pct}%
        </Typography>
      </Box>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{ height: 8, borderRadius: 4, "& .MuiLinearProgress-bar": { bgcolor: atTarget ? "#16a34a" : "#d97706" } }}
      />
    </Box>
  );
}

function PillarCard({
  pillar,
  applicable,
  phenotype,
  patientId,
  existingTaskId,
  taskState,
  labState,
  onCreateTask,
  onOrderLabs,
}: {
  pillar: PillarResult;
  applicable: boolean;
  phenotype: Phenotype;
  patientId: string;
  existingTaskId?: string;
  taskState: ActionState;
  labState: ActionState;
  onCreateTask: () => void;
  onOrderLabs: () => void;
}) {
  const meta = STATUS_META[pillar.status];
  const canTask = applicable && TASK_STATUSES.has(pillar.status);
  const canLabs = applicable && pillar.status === "GAP_LABS_NEEDED";

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, opacity: applicable ? 1 : 0.6 }}>
      <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.3 }}>
          {pillar.label}
        </Typography>
        <Chip size="small" label={meta.label} sx={{ bgcolor: meta.bg, color: meta.fg, fontWeight: 700, flexShrink: 0 }} />
      </Box>

      {pillar.agent && (
        <Typography variant="body2" sx={{ fontWeight: 600, mt: 0.5 }}>
          {pillar.agent.name}
        </Typography>
      )}
      <DoseBar pillar={pillar} />

      {pillar.agent?.startedOn && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.75 }}>
          On since {fmtDay(pillar.agent.startedOn)}
          {pillar.titration?.daysOnTherapy != null ? ` · ${pillar.titration.daysOnTherapy} days` : ""}
        </Typography>
      )}

      {pillar.titration?.overdue && (
        <Box
          sx={{
            mt: 1,
            p: 1,
            borderRadius: 1.5,
            bgcolor: "#fffbeb",
            border: "1px solid #fde68a",
          }}
        >
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
            <WarningAmberIcon sx={{ fontSize: 18, color: "#b45309" }} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: "#92400e" }}>
              Due for up-titration — {pillar.titration.daysOnTherapy} days at sub-target dose
              (review interval {pillar.titration.intervalDays} days).
            </Typography>
          </Box>
          <CitationLine citationRef="AHA-ACC-HFSA-2022-7.3-titration" />
        </Box>
      )}

      <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
        {pillar.reason}
      </Typography>

      {!applicable && (
        <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5, fontStyle: "italic" }}>
          Not part of the core program for {phenotype}.
        </Typography>
      )}

      <CitationLine citationRef={pillar.citationRef} />

      {(canTask || canLabs) && (
        <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          {canTask &&
            (existingTaskId ? (
              <>
                <Chip
                  size="small"
                  icon={<CheckCircleIcon />}
                  label="FHIR Task already created"
                  sx={{ bgcolor: "#dcfce7", color: "#15803d", fontWeight: 700, "& .MuiChip-icon": { color: "#15803d" } }}
                />
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<ArrowForwardIcon />}
                  component={RouterLink}
                  to={`/patients/${patientId}/tasks?highlight=${existingTaskId}`}
                >
                  View task
                </Button>
              </>
            ) : (
              <Button
                size="small"
                variant="contained"
                startIcon={<MonitorHeartIcon />}
                disabled={taskState.status === "busy"}
                onClick={onCreateTask}
              >
                {taskState.status === "busy"
                  ? "Creating…"
                  : pillar.suggestedAction?.kind === "UPTITRATE"
                    ? "Create up-titration Task"
                    : "Create FHIR Task"}
              </Button>
            ))}
          {canLabs && (
            <Button
              size="small"
              variant="outlined"
              startIcon={<ScienceIcon />}
              disabled={labState.status === "busy" || labState.status === "done"}
              onClick={onOrderLabs}
            >
              {labState.status === "busy" ? "Ordering…" : labState.status === "done" ? "✓ Labs ordered" : "Order labs"}
            </Button>
          )}
          {(taskState.status === "error" || labState.status === "error") && (
            <Typography variant="caption" color="error.main">
              {taskState.msg ?? labState.msg}
            </Typography>
          )}
        </Box>
      )}
    </Paper>
  );
}

function SafetyNote() {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, bgcolor: "#f8fafc" }}>
      <Typography variant="caption" color="text.secondary">
        <strong>The engine decides; AI only explains.</strong> Every pillar status is computed
        deterministically from coded rules (LVEF, labs, vitals, contraindications) and carries a
        guideline citation. This is decision support — it never auto-prescribes; a clinician accepts
        each action before any FHIR resource is written.
      </Typography>
    </Paper>
  );
}
