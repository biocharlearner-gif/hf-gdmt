import { useCallback, useEffect, useMemo, useState } from "react";
import { Link as RouterLink, useOutletContext, useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Typography,
} from "@mui/material";
import PrintIcon from "@mui/icons-material/PrintOutlined";
import RefreshIcon from "@mui/icons-material/Refresh";
import AssignmentTurnedInIcon from "@mui/icons-material/AssignmentTurnedInOutlined";
import OpenInFullIcon from "@mui/icons-material/OpenInFull";
import {
  getObservations,
  getMedications,
  getConditions,
  getTasksForPatient,
  getCarePlans,
  createResourceIfNoneExist,
  updateResource,
  type FhirResource,
} from "./patientApi";
import { buildEngineInput } from "../fhir/extract";
import { evaluateGdmt, isApplicablePillar, type GdmtAssessment, type PillarResult, type PillarStatus } from "../engine/engine";
import { projectBenefit } from "../engine/benefit";
import { buildCarePlan } from "../fhir/writeback";
import { carePlanSummaryHtml } from "./carePlanSummary";
import { DEMO_TAG } from "./fhirConfig";
import { CURRENT_USER } from "./currentUser";
import { HF_FALLBACK_CODES } from "./hfCohort";
import { fmtDay } from "./format";
import CitationLine from "./CitationLine";
import type { PatientOutletContext } from "./PatientViewPage";

/**
 * Care Plan tab — turns the deterministic GDMT assessment into a persisted, viewable,
 * printable FHIR CarePlan. The engine decides the content; this tab creates it
 * idempotently (search-then-create by identifier), renders it as a clinical artifact,
 * keeps it current (Regenerate), and exports a patient handout (Print / Save PDF).
 */

const GDMT_IDENTIFIER_SYSTEM = "urn:hf-gdmt:gdmt";

const STATUS_META: Record<PillarStatus, { label: string; bg: string; fg: string }> = {
  ON_TARGET: { label: "On target", bg: "#dcfce7", fg: "#15803d" },
  ON_SUBTARGET: { label: "On — sub-target", bg: "#fef9c3", fg: "#854d0e" },
  GAP_ELIGIBLE: { label: "Gap — eligible", bg: "#fee2e2", fg: "#b91c1c" },
  GAP_LABS_NEEDED: { label: "Labs needed", bg: "#e0eaff", fg: "#3056d3" },
  CONTRAINDICATED: { label: "Contraindicated", bg: "#f1f5f9", fg: "#475569" },
  INSUFFICIENT_DATA: { label: "Insufficient data", bg: "#f1f5f9", fg: "#475569" },
};

/**
 * HF Condition codes we may `addresses` — reuse the cohort's curated HF value set
 * (`HF_FALLBACK_CODES`) so this matches the same conditions the roster treats as HF,
 * without an async terminology call. Plus any ICD-10 I50.* by prefix.
 */
const HF_CODE_SET = new Set(HF_FALLBACK_CODES.map((c) => c.code));

function hfCondition(conditions: FhirResource[]): { ref: string; label: string } | undefined {
  for (const c of conditions as Array<{ id?: string; code?: { text?: string; coding?: { code?: string; display?: string }[] } }>) {
    for (const cd of c.code?.coding ?? []) {
      if (cd.code && (HF_CODE_SET.has(cd.code) || cd.code.toUpperCase().startsWith("I50"))) {
        return { ref: `Condition/${c.id}`, label: c.code?.text ?? cd.display ?? "Heart failure" };
      }
    }
  }
  return undefined;
}

/** Map existing GDMT Tasks back to their pillar id + status (identifier `<patient>:<pillar>:task`). */
function tasksByPillar(patientId: string, tasks: FhirResource[]): Record<string, { id: string; status: string }> {
  const out: Record<string, { id: string; status: string }> = {};
  for (const t of tasks) {
    for (const idf of ((t.identifier as { system?: string; value?: string }[] | undefined) ?? [])) {
      if (idf.system === GDMT_IDENTIFIER_SYSTEM && idf.value?.startsWith(`${patientId}:`) && idf.value.endsWith(":task")) {
        const pillar = idf.value.slice(patientId.length + 1, -":task".length);
        if (t.id) out[pillar] = { id: String(t.id), status: String(t.status ?? "requested") };
      }
    }
  }
  return out;
}

type Loaded = {
  assessment: GdmtAssessment;
  conditions: FhirResource[];
  tasks: FhirResource[];
};

export default function CarePlanTab() {
  const { id: patientId = "" } = useParams();
  const { patient } = useOutletContext<PatientOutletContext>();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<Loaded | null>(null);
  const [carePlan, setCarePlan] = useState<FhirResource | null>(null);
  const [busy, setBusy] = useState<null | "generate" | "regenerate">(null);
  const [msg, setMsg] = useState<{ tone: "success" | "error"; text: string } | null>(null);

  const patientRef = `Patient/${patientId}`;
  const careIdValue = `${patientId}:careplan`;
  const careSearch = `identifier=${GDMT_IDENTIFIER_SYSTEM}|${careIdValue}`;

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getObservations(patientId),
      getMedications(patientId),
      getConditions(patientId),
      getTasksForPatient(patientId).catch(() => [] as FhirResource[]),
      getCarePlans(patientId).catch(() => [] as FhirResource[]),
    ])
      .then(([observations, medications, conditions, tasks, plans]) => {
        const input = buildEngineInput({ patientId, now: new Date().toISOString(), observations, medications, conditions });
        setData({ assessment: evaluateGdmt(input), conditions, tasks });
        setCarePlan(
          plans.find((p) =>
            ((p.identifier as { system?: string; value?: string }[] | undefined) ?? []).some(
              (idf) => idf.system === GDMT_IDENTIFIER_SYSTEM && idf.value === careIdValue,
            ),
          ) ?? null,
        );
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load care plan"))
      .finally(() => setLoading(false));
  }, [patientId, careIdValue]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const benefit = useMemo(() => (data ? projectBenefit(data.assessment) : null), [data]);
  const pillarTasks = useMemo(() => (data ? tasksByPillar(patientId, data.tasks) : {}), [data, patientId]);
  const condition = useMemo(() => (data ? hfCondition(data.conditions) : undefined), [data]);

  /** Build the tagged CarePlan resource for the current assessment. */
  const buildResource = useCallback(() => {
    if (!data) return null;
    const taskRefs = Object.values(pillarTasks).map((t) => `Task/${t.id}`);
    const resource = buildCarePlan(data.assessment, taskRefs, {
      patientRef,
      conditionRef: condition?.ref,
      authorDisplay: CURRENT_USER.display,
    });
    return {
      ...resource,
      meta: { tag: [{ ...DEMO_TAG }] },
      identifier: [{ system: GDMT_IDENTIFIER_SYSTEM, value: careIdValue }],
    } as unknown as FhirResource;
  }, [data, pillarTasks, condition, patientRef, careIdValue]);

  async function generate() {
    const resource = buildResource();
    if (!resource) return;
    setBusy("generate");
    setMsg(null);
    try {
      const created = await createResourceIfNoneExist(resource, careSearch);
      setCarePlan(created);
      setMsg({ tone: "success", text: `Care plan ready (CarePlan/${created.id ?? "?"}).` });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Failed to create care plan" });
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    const resource = buildResource();
    if (!resource || !carePlan?.id) return;
    setBusy("regenerate");
    setMsg(null);
    try {
      const updated = await updateResource({ ...resource, id: carePlan.id });
      setCarePlan(updated);
      setMsg({ tone: "success", text: "Care plan refreshed from the current assessment." });
    } catch (e) {
      setMsg({ tone: "error", text: e instanceof Error ? e.message : "Failed to refresh care plan" });
    } finally {
      setBusy(null);
    }
  }

  function printSummary() {
    if (!data) return;
    const html = carePlanSummaryHtml({ patient, assessment: data.assessment, benefit, generatedBy: CURRENT_USER.display });
    const w = window.open("", "_blank");
    if (!w) {
      setMsg({ tone: "error", text: "Popup blocked — allow popups to print the care summary." });
      return;
    }
    w.document.write(html);
    w.document.close();
    w.focus();
    w.print();
  }

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!data) return <Alert severity="warning">No assessment available.</Alert>;

  const { assessment } = data;
  if (assessment.phenotype === "Unknown") {
    return (
      <Alert severity="info" action={<Button component={RouterLink} to={`/patients/${patientId}/gdmt`} size="small">Go to GDMT</Button>}>
        LVEF is unknown — determine the phenotype (order an echocardiogram on the GDMT tab) before building a GDMT care plan.
      </Alert>
    );
  }

  const applicable = assessment.pillars.filter((p) => isApplicablePillar(assessment.phenotype, p.id));
  const eligibleGaps = applicable.filter((p) => p.status === "GAP_ELIGIBLE").length;
  const goals = [
    "Achieve target-dose GDMT across all eligible pillars",
    ...(eligibleGaps > 0 ? [`Close ${eligibleGaps} eligible GDMT gap(s) now`] : []),
  ];
  const citeRefs = [...new Set(applicable.map((p) => p.citationRef))];

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2.5 }}>
      {/* Header / status + actions */}
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5, display: "flex", alignItems: "flex-start", gap: 2, flexWrap: "wrap" }}>
        <AssignmentTurnedInIcon color="primary" sx={{ mt: 0.25 }} />
        <Box sx={{ flexGrow: 1, minWidth: 220 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Heart Failure GDMT Optimization</Typography>
          {carePlan ? (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap", mt: 0.5 }}>
              <Chip size="small" label={`Status: ${String(carePlan.status ?? "active")}`} sx={{ bgcolor: "#dcfce7", color: "#15803d", fontWeight: 700 }} />
              <Typography variant="body2" color="text.secondary">
                Created {fmtDay(carePlan.created as string | undefined)}
                {condition ? ` · Addresses ${condition.label}` : ""}
                {(carePlan.author as { display?: string } | undefined)?.display ? ` · ${(carePlan.author as { display?: string }).display}` : ""}
              </Typography>
            </Box>
          ) : (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              No care plan yet. Generating bundles the assessment into one FHIR CarePlan — {applicable.length} pillar
              activities, {goals.length} goal(s){condition ? `, addressing ${condition.label}` : ""} — created idempotently (no duplicates).
            </Typography>
          )}
          {msg && (
            <Typography variant="caption" sx={{ color: msg.tone === "error" ? "error.main" : "success.main", display: "block", mt: 0.5 }}>
              {msg.text}
            </Typography>
          )}
        </Box>
        <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
          {carePlan ? (
            <>
              <Button variant="outlined" startIcon={<PrintIcon />} onClick={printSummary}>Print / Save PDF</Button>
              <Button variant="outlined" startIcon={<RefreshIcon />} disabled={busy === "regenerate"} onClick={regenerate}>
                {busy === "regenerate" ? "Refreshing…" : "Regenerate"}
              </Button>
            </>
          ) : (
            <Button variant="contained" startIcon={<OpenInFullIcon />} disabled={busy === "generate"} onClick={generate}>
              {busy === "generate" ? "Generating…" : "Generate care plan"}
            </Button>
          )}
        </Box>
      </Paper>

      {/* Goals */}
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5 }}>
        <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>Goals</Typography>
        <Box component="ul" sx={{ m: 0, mt: 0.5, pl: 2.5 }}>
          {goals.map((g) => (
            <Typography component="li" variant="body2" key={g} sx={{ mb: 0.25 }}>{g}</Typography>
          ))}
        </Box>
      </Paper>

      {/* Activities */}
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5 }}>
        <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>Plan activities — four pillars</Typography>
        <TableContainer sx={{ mt: 0.5 }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={{ fontWeight: 700 }}>Pillar</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Medication / dose</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Linked task</TableCell>
                <TableCell sx={{ fontWeight: 700 }}>Next step</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {applicable.map((p) => (
                <ActivityRow key={p.id} pillar={p} task={pillarTasks[p.id]} />
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* Benefit snapshot */}
      {benefit && (
        <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5 }}>
          <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>Projected benefit (relative risk reduction)</Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 2, mt: 0.5 }}>
            <BenefitStat label="Current therapy" value={`${Math.round(benefit.currentRRR * 100)}%`} />
            <BenefitStat label="If eligible gaps closed" value={`${Math.round(benefit.potentialRRR * 100)}%`} />
            <BenefitStat label="Additional available now" value={`+${Math.round(benefit.incrementalRRR * 100)}%`} />
          </Box>
        </Paper>
      )}

      {/* Guideline sources */}
      <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5 }}>
        <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>Guideline sources</Typography>
        <Box sx={{ mt: 0.25 }}>
          {citeRefs.map((ref) => (
            <CitationLine key={ref} citationRef={ref} />
          ))}
        </Box>
      </Paper>

      <Typography variant="caption" color="text.secondary">
        <strong>Decision support, not a prescription.</strong> Every activity status is derived deterministically from the
        engine (LVEF, labs, vitals, contraindications) with a guideline citation. A clinician accepts each action; the plan
        does not itself order therapy.
      </Typography>
    </Box>
  );
}

function ActivityRow({ pillar, task }: { pillar: PillarResult; task?: { id: string; status: string } }) {
  const meta = STATUS_META[pillar.status];
  const dose = pillar.agent
    ? pillar.agent.dailyDoseMg && pillar.agent.targetDoseMg
      ? `${pillar.agent.name} · ${pillar.agent.dailyDoseMg}/${pillar.agent.targetDoseMg} mg/day`
      : pillar.agent.name
    : "—";
  return (
    <TableRow>
      <TableCell sx={{ fontWeight: 600 }}>{pillar.label}</TableCell>
      <TableCell>{dose}</TableCell>
      <TableCell>
        <Chip size="small" label={meta.label} sx={{ bgcolor: meta.bg, color: meta.fg, fontWeight: 700 }} />
      </TableCell>
      <TableCell>
        {task ? <Chip size="small" variant="outlined" label={task.status} /> : <Typography variant="caption" color="text.secondary">—</Typography>}
      </TableCell>
      <TableCell sx={{ color: "text.secondary" }}>{pillar.suggestedAction?.text ?? pillar.reason}</TableCell>
    </TableRow>
  );
}

function BenefitStat({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ textAlign: "center", p: 1.25, borderRadius: 2, bgcolor: "#f8fafc" }}>
      <Typography variant="h5" sx={{ fontWeight: 800 }}>{value}</Typography>
      <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 600 }}>{label}</Typography>
    </Box>
  );
}
