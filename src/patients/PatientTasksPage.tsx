import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";
import { getTasksForPatient, getObservations, type FhirResource } from "./patientApi";
import { buildAlertInput } from "../fhir/extract";
import { evaluateOutcomeAlerts } from "../engine/alerts";
import TaskCard from "./TaskCard";

/**
 * Patient-view "Tasks" tab — all tasks for the in-context patient, each with the full
 * workflow + an expandable trend for its vital (the shared TaskCard). Mirrors the
 * global Tasks page but scoped to one patient.
 */
export default function PatientTasksPage() {
  const { id = "" } = useParams();
  const [searchParams] = useSearchParams();
  /** Task deep-linked from elsewhere (e.g. a GDMT pillar that already has a Task). */
  const highlightId = searchParams.get("highlight") ?? undefined;
  const highlightRef = useRef<HTMLDivElement | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tasks, setTasks] = useState<FhirResource[]>([]);
  const [activeAlertVitals, setActiveAlertVitals] = useState<Set<string> | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([getTasksForPatient(id), getObservations(id).catch(() => [])])
      .then(([ts, obs]) => {
        setTasks(ts);
        // Outcome loop: vitals still abnormal on the latest reading (recency-independent).
        const alerts = evaluateOutcomeAlerts(buildAlertInput({ patientId: id, observations: obs }));
        setActiveAlertVitals(new Set(alerts.map((a) => a.vital)));
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load tasks"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  useEffect(() => {
    if (!loading && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [loading, highlightId]);

  const onChanged = (updated: FhirResource) =>
    setTasks((ts) => ts.map((t) => (t.id === updated.id ? updated : t)));

  const sorted = useMemo(
    () => [...tasks].sort((a, b) => String(b.authoredOn ?? "").localeCompare(String(a.authoredOn ?? ""))),
    [tasks],
  );

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;
  if (sorted.length === 0) {
    return (
      <Alert severity="info">
        No tasks for this patient yet. Tasks are created when a clinician accepts an alert on the Vitals tab.
      </Alert>
    );
  }

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
      <Typography variant="h6" sx={{ fontWeight: 700 }}>Tasks ({sorted.length})</Typography>
      {sorted.map((t) => {
        const isHighlighted = highlightId !== undefined && String(t.id) === highlightId;
        return (
          <Box
            key={String(t.id)}
            ref={isHighlighted ? highlightRef : undefined}
            sx={isHighlighted ? { borderRadius: 2, outline: "2px solid", outlineColor: "primary.main" } : undefined}
          >
            <TaskCard task={t} patientId={id} activeAlertVitals={activeAlertVitals} onChanged={onChanged} />
          </Box>
        );
      })}
    </Box>
  );
}
