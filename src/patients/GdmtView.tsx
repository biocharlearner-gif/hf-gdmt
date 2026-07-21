import { useMemo, type ReactNode } from "react";
import { Link as RouterLink } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
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
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesomeOutlined";
import {
  gdmtStage,
  isApplicablePillar,
  type GdmtAssessment,
  type GdmtStage,
  type PillarResult,
  type PillarStatus,
  type Phenotype,
} from "../engine/engine";
import { projectBenefit } from "../engine/benefit";
import { fmtDay } from "./format";
import CitationLine from "./CitationLine";
import type { PillarRationale } from "./patientApi";

/**
 * Presentational GDMT assessment — the flagship four-pillar panel, extracted so it can be
 * rendered by BOTH data sources without duplicating the UI:
 *   - the demo `GdmtTab` (reads the Medblocks tenant via patientApi), and
 *   - the SMART/Epic `PatientView` (reads Epic via loadPatient, in-browser token).
 *
 * It is pure display + action wiring: the caller supplies the already-computed engine
 * `assessment`, the AI-explanation state, and per-action handlers/state. Benefit and stage
 * are derived here (both pure). The engine decides; this only shows it and offers the writes.
 */

export type RationaleMode = "llm" | "prebaked" | "deterministic";

export interface ActionState {
  status: "idle" | "busy" | "done" | "error";
  msg?: string;
}
const IDLE_ACTION: ActionState = { status: "idle" };

export interface GdmtViewProps {
  assessment: GdmtAssessment;
  // AI cited explanations
  rationale: Record<string, PillarRationale>;
  rationaleMode: RationaleMode | null;
  rationaleBusy: boolean;
  rationaleError: string | null;
  onExplain: () => void;
  // per-action state, keyed: `<pillarId>` (task), `labs:<pillarId>`, `echo`
  actions: Record<string, ActionState>;
  /** pillar id → id of an existing gap Task on the server (demo idempotency); omit if untracked. */
  existingTasks?: Record<string, string>;
  onCreateTask: (pillar: PillarResult) => void;
  onOrderLabs: (pillar: PillarResult) => void;
  onOrderEcho: () => void;
  /** Build a link to a created Task (demo → Tasks tab). Omit to render the "created" chip with no link. */
  taskHref?: (taskId: string) => string;
  /** Host-specific footer (CarePlan CTA/button). Rendered before the safety note, hidden for Unknown. */
  footer?: ReactNode;
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

export default function GdmtView({
  assessment,
  rationale,
  rationaleMode,
  rationaleBusy,
  rationaleError,
  onExplain,
  actions,
  existingTasks,
  onCreateTask,
  onOrderLabs,
  onOrderEcho,
  taskHref,
  footer,
}: GdmtViewProps) {
  const benefit = useMemo(() => projectBenefit(assessment), [assessment]);
  const stage = useMemo(() => gdmtStage(assessment), [assessment]);

  const { phenotype, lvef } = assessment;
  const isHfref = phenotype === "HFrEF";
  const isUnknown = phenotype === "Unknown";
  const echoState = actions["echo"] ?? IDLE_ACTION;

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {isHfref ? (
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 2, alignItems: "stretch" }}>
          <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <PhenotypeBanner phenotype={phenotype} lvef={lvef} onOrderEcho={onOrderEcho} echoState={echoState} />
            <ScoreCard assessment={assessment} />
          </Box>
          <StageBanner stage={stage} />
          <BenefitCard benefit={benefit} />
        </Box>
      ) : (
        <>
          <PhenotypeBanner phenotype={phenotype} lvef={lvef} onOrderEcho={onOrderEcho} echoState={echoState} />
          {!isUnknown && <StageBanner stage={stage} />}
        </>
      )}

      <Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1, mb: 1.5, flexWrap: "wrap" }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Guideline-directed medical therapy — four pillars
          </Typography>
          <Box sx={{ textAlign: "right" }}>
            <Button size="small" variant="outlined" startIcon={<AutoAwesomeIcon />} disabled={rationaleBusy} onClick={onExplain}>
              {rationaleBusy ? "Explaining…" : rationaleMode ? "Regenerate explanations" : "Explain with cited AI"}
            </Button>
            {rationaleMode && (
              <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 0.5 }}>
                {rationaleMode === "llm"
                  ? "Live AI, grounded in engine facts + cited guideline evidence"
                  : rationaleMode === "prebaked"
                    ? "AI-drafted & cited — grounded in engine facts + guideline evidence"
                    : "Cited explanations grounded in engine facts + guideline evidence"}
              </Typography>
            )}
          </Box>
        </Box>
        {rationaleError && (
          <Alert severity="warning" sx={{ mb: 1.5 }}>
            {rationaleError}
          </Alert>
        )}
        <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2 }}>
          {assessment.pillars.map((p) => (
            <PillarCard
              key={p.id}
              pillar={p}
              applicable={isApplicablePillar(phenotype, p.id)}
              phenotype={phenotype}
              existingTaskId={existingTasks?.[p.id]}
              taskHref={taskHref}
              taskState={actions[p.id] ?? IDLE_ACTION}
              labState={actions[`labs:${p.id}`] ?? IDLE_ACTION}
              rationale={rationale[p.id]}
              onCreateTask={() => onCreateTask(p)}
              onOrderLabs={() => onOrderLabs(p)}
            />
          ))}
        </Box>
      </Box>

      {!isUnknown && footer}

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

const STAGE_STEPS: { label: string; hint: string }[] = [
  { label: "Initiation", hint: "Begin the four pillars" },
  { label: "Active titration", hint: "Up-titrate toward target doses" },
  { label: "Optimized", hint: "All tolerated pillars at target" },
];
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
const MUTED = "#94a3b8";
const RAIL = "#e2e8f0";

function StageBanner({ stage }: { stage: GdmtStage }) {
  const active = stageStepIndex(stage.id);
  const tone = STAGE_TONE[stage.tone];
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5, borderColor: tone.border, bgcolor: tone.bg, display: "flex", flexDirection: "column" }}>
      <Box sx={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 1, mb: 1.75 }}>
        <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary", lineHeight: 1 }}>
          GDMT journey
        </Typography>
        {stage.lastChangeDays !== undefined && (
          <Typography variant="caption" sx={{ color: "text.secondary", whiteSpace: "nowrap" }}>
            last change {stage.lastChangeDays}d ago
          </Typography>
        )}
      </Box>

      <Box sx={{ flexGrow: 1 }}>
        {STAGE_STEPS.map((s, i) => {
          const done = i < active;
          const current = i === active;
          const last = i === STAGE_STEPS.length - 1;
          const labelColor = current ? tone.fg : done ? "text.primary" : MUTED;
          return (
            <Box key={s.label} sx={{ display: "flex", gap: 1.5 }}>
              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", flexShrink: 0 }}>
                {done ? (
                  <CheckCircleIcon sx={{ fontSize: 24, color: tone.fg }} />
                ) : (
                  <Box
                    sx={{
                      width: 24,
                      height: 24,
                      borderRadius: "50%",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      bgcolor: current ? tone.fg : "#fff",
                      border: current ? "none" : `2px solid ${RAIL}`,
                      boxShadow: current ? `0 0 0 4px ${tone.bg}` : "none",
                    }}
                  >
                    <Box sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: current ? "#fff" : MUTED }} />
                  </Box>
                )}
                {!last && <Box sx={{ flexGrow: 1, width: 2, minHeight: 18, my: 0.5, bgcolor: done ? tone.fg : RAIL }} />}
              </Box>

              <Box sx={{ pb: last ? 0 : 1.5, pt: 0.15, minWidth: 0 }}>
                <Typography variant="body2" sx={{ fontWeight: current ? 800 : 600, color: labelColor, lineHeight: 1.3 }}>
                  {s.label}
                </Typography>
                <Typography variant="caption" sx={{ color: current ? "text.secondary" : MUTED, display: "block", lineHeight: 1.35 }}>
                  {current ? stage.summary : s.hint}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>

      {stage.nextStep && (
        <Box sx={{ mt: 1, p: 1.25, borderRadius: 1.5, bgcolor: "#fff", border: `1px solid ${tone.border}` }}>
          <Typography variant="caption" sx={{ fontWeight: 800, color: tone.fg, letterSpacing: 0.4, display: "block", mb: 0.25 }}>
            NEXT STEP
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.4 }}>
            {stage.nextStep}
          </Typography>
        </Box>
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
      <LinearProgress variant="determinate" value={Math.round(assessment.optimizationPct * 100)} sx={{ height: 8, borderRadius: 4, my: 1 }} />
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
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1, fontSize: "0.68rem", lineHeight: 1.4 }}>
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
  existingTaskId,
  taskHref,
  taskState,
  labState,
  rationale,
  onCreateTask,
  onOrderLabs,
}: {
  pillar: PillarResult;
  applicable: boolean;
  phenotype: Phenotype;
  existingTaskId?: string;
  taskHref?: (taskId: string) => string;
  taskState: ActionState;
  labState: ActionState;
  rationale?: PillarRationale;
  onCreateTask: () => void;
  onOrderLabs: () => void;
}) {
  const meta = STATUS_META[pillar.status];
  const canTask = applicable && TASK_STATUSES.has(pillar.status);
  const canLabs = applicable && pillar.status === "GAP_LABS_NEEDED";
  const taskCreated = !!existingTaskId || taskState.status === "done";

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
        <Box sx={{ mt: 1, p: 1, borderRadius: 1.5, bgcolor: "#fffbeb", border: "1px solid #fde68a" }}>
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

      {rationale && (
        <Box sx={{ mt: 1.5, p: 1.25, borderRadius: 1.5, bgcolor: "#f5f3ff", border: "1px solid #ddd6fe" }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, mb: 0.5 }}>
            <AutoAwesomeIcon sx={{ fontSize: 16, color: "#6d28d9" }} />
            <Typography variant="caption" sx={{ fontWeight: 700, color: "#5b21b6" }}>
              {rationale.source === "llm"
                ? "AI explanation — grounded & cited"
                : rationale.source === "prebaked"
                  ? "AI-drafted explanation — grounded & cited"
                  : "Cited explanation"}
            </Typography>
          </Box>
          <Typography variant="body2" color="text.secondary">
            {rationale.text}
          </Typography>
          {rationale.citations.map((ref) => (
            <CitationLine key={ref} citationRef={ref} />
          ))}
        </Box>
      )}

      {(canTask || canLabs) && (
        <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          {canTask &&
            (taskCreated ? (
              <>
                <Chip
                  size="small"
                  icon={<CheckCircleIcon />}
                  label="FHIR Task already created"
                  sx={{ bgcolor: "#dcfce7", color: "#15803d", fontWeight: 700, "& .MuiChip-icon": { color: "#15803d" } }}
                />
                {existingTaskId && taskHref && (
                  <Button size="small" variant="outlined" endIcon={<ArrowForwardIcon />} component={RouterLink} to={taskHref(existingTaskId)}>
                    View task
                  </Button>
                )}
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
