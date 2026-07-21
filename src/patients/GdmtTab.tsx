import { useCallback, useEffect, useState } from "react";
import { Link as RouterLink, useParams } from "react-router-dom";
import { Alert, Box, Button, CircularProgress, Paper, Typography } from "@mui/material";
import ArrowForwardIcon from "@mui/icons-material/ArrowForward";
import { getObservations, getMedications, getConditions, getTasksForPatient, createResourceIfNoneExist, getRationale, type FhirResource, type PillarRationale } from "./patientApi";
import { buildEngineInput } from "../fhir/extract";
import { evaluateGdmt, type GdmtAssessment, type PillarResult, type PillarId } from "../engine/engine";
import { buildTaskForGap, buildLabServiceRequest } from "../fhir/writeback";
import { DEMO_TAG } from "./fhirConfig";
import { CURRENT_USER } from "./currentUser";
import GdmtView, { type ActionState, type RationaleMode } from "./GdmtView";

/**
 * GDMT tab (demo host) — fetches the patient's Observations / Conditions / Medications from
 * the Medblocks tenant via patientApi, feeds the PURE `evaluateGdmt` engine, and renders the
 * shared `GdmtView`. Write-backs (idempotent Task per gap, lab / echo ServiceRequest) go back
 * to the tenant. The Epic SMART path renders the SAME `GdmtView` from its own read/write plumbing.
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
  // RAG cited explanations, keyed by pillar id, plus request state.
  const [rationale, setRationale] = useState<Record<string, PillarRationale>>({});
  const [rationaleMode, setRationaleMode] = useState<RationaleMode | null>(null);
  const [rationaleBusy, setRationaleBusy] = useState(false);
  const [rationaleError, setRationaleError] = useState<string | null>(null);

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

  async function explainGaps() {
    if (!assessment) return;
    setRationaleBusy(true);
    setRationaleError(null);
    try {
      const res = await getRationale(assessment);
      setRationale(Object.fromEntries(res.pillars.map((p) => [p.pillarId, p])));
      setRationaleMode(res.mode);
    } catch (e) {
      setRationaleError(e instanceof Error ? e.message : "Failed to generate explanations");
    } finally {
      setRationaleBusy(false);
    }
  }

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (!assessment) return <Alert severity="warning">No assessment available.</Alert>;

  return (
    <GdmtView
      assessment={assessment}
      rationale={rationale}
      rationaleMode={rationaleMode}
      rationaleBusy={rationaleBusy}
      rationaleError={rationaleError}
      onExplain={explainGaps}
      actions={actions}
      existingTasks={existingTasks}
      onCreateTask={createTask}
      onOrderLabs={orderLabs}
      onOrderEcho={orderEcho}
      taskHref={(taskId) => `/patients/${patientId}/tasks?highlight=${taskId}`}
      footer={
        <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <Box sx={{ flexGrow: 1, minWidth: 200 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Bundle into a GDMT CarePlan
            </Typography>
            <Typography variant="body2" color="text.secondary">
              The Care Plan tab bundles these pillars into one Heart Failure GDMT Optimization CarePlan
              (goals, per-pillar activities, linked Tasks) — created once, viewable, and printable as a patient summary.
              {taskRefs.length > 0 ? ` ${taskRefs.length} Task(s) will link.` : ""}
            </Typography>
          </Box>
          <Button variant="contained" endIcon={<ArrowForwardIcon />} component={RouterLink} to={`/patients/${patientId}/careplan`}>
            Open care plan
          </Button>
        </Paper>
      }
    />
  );
}
