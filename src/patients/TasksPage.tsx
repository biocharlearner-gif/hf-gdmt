import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  FormControl,
  IconButton,
  InputLabel,
  MenuItem,
  Paper,
  Select,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import LaunchIcon from "@mui/icons-material/OpenInNew";
import AssignmentIcon from "@mui/icons-material/AssignmentOutlined";
import { fetchTaggedPatients, getObservations, getTasksForPatient, type FhirResource } from "./patientApi";
import { fullName, mrnOf, initialsOf, avatarColors, type FhirPatient } from "./patientMapper";
import { buildAlertInput } from "../fhir/extract";
import { evaluateAlerts, evaluateOutcomeAlerts } from "../engine/alerts";
import { computeRiskScore, type RiskScore } from "../engine/risk";
import { RISK_COLOR } from "./riskColors";
import TaskCard from "./TaskCard";

/**
 * Tasks page — master/detail. Left third lists patients that have open work; the
 * right two-thirds shows the selected patient's Tasks with the clinician action items
 * valid for each Task's current FHIR workflow status.
 *
 * Tasks are the loop-closure artifact: GDMT gap follow-ups (`buildTaskForGap`) and
 * remote-monitoring alert follow-ups (`buildTaskForAlert`).
 */

interface TaskGroup {
  patient: FhirPatient;
  tasks: FhirResource[];
  risk: RiskScore;
  /** Vitals still abnormal on the LATEST reading (recency-independent) — for the outcome chip. */
  outcomeVitals: Set<string>;
}

/** Sort sickest-first, then alphabetically. */
function byRiskThenName(a: TaskGroup, b: TaskGroup): number {
  return b.risk.score - a.risk.score || fullName(a.patient).localeCompare(fullName(b.patient));
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

export default function TasksPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [groups, setGroups] = useState<TaskGroup[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  /** Bumped on every load; async steps from a superseded run are ignored (StrictMode-safe). */
  const loadSeq = useRef(0);

  const load = useCallback(() => {
    const seq = ++loadSeq.current;
    const alive = () => seq === loadSeq.current;
    setLoading(true);
    setLoadingMore(true);
    setError(null);
    setGroups([]);
    (async () => {
      const patients = await fetchTaggedPatients();
      if (!alive()) return;
      // NOTE: the public HAPI server rejects/drops a bulk `GET /Task` and bursts of
      // concurrent requests, so we fetch one patient at a time. Once we have a write-
      // enabled server that allows a single all-Tasks query, replace this loop.
      // (Tracked in docs/PROGRESS.md.) To avoid making the clinician wait for the whole
      // cohort, we render each patient's tasks as soon as they arrive (progressive).
      for (const patient of patients) {
        const tasks = patient.id ? await getTasksForPatient(patient.id) : [];
        if (!alive()) return; // a newer load superseded this one
        if (tasks.length === 0) continue;
        // Compute the patient's current HF risk to rank the list (sickest first).
        const obs = patient.id ? await getObservations(patient.id).catch(() => []) : [];
        if (!alive()) return;
        const alertInput = buildAlertInput({ patientId: patient.id ?? "", observations: obs });
        const risk = computeRiskScore(evaluateAlerts(alertInput));
        // Outcome uses the latest reading (not wall-clock recency) so "improved" can't
        // be claimed while the last value is still abnormal.
        const outcomeVitals = new Set(evaluateOutcomeAlerts(alertInput).map((a) => a.vital));
        const group: TaskGroup = { patient, tasks, risk, outcomeVitals };
        setGroups((prev) =>
          prev.some((g) => g.patient.id === patient.id)
            ? prev // already added — never duplicate a patient
            : [...prev, group].sort(byRiskThenName),
        );
        // Don't pin selection here — `selected` falls back to the top (highest-risk) row.
        setLoading(false); // first group is enough to show the page
      }
    })()
      .catch((e: unknown) => {
        if (alive()) setError(e instanceof Error ? e.message : "Failed to load tasks");
      })
      .finally(() => {
        if (alive()) {
          setLoading(false);
          setLoadingMore(false);
        }
      });
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  /** Tasks matching the current status filter, grouped; empty groups are dropped. */
  const filteredGroups = useMemo(() => {
    if (statusFilter === "all") return groups;
    return groups
      .map((g) => ({ ...g, tasks: g.tasks.filter((t) => str(t.status) === statusFilter) }))
      .filter((g) => g.tasks.length > 0);
  }, [groups, statusFilter]);

  /** Status values actually present across the cohort, for the filter dropdown. */
  const presentStatuses = useMemo(() => {
    const set = new Set<string>();
    for (const g of groups) for (const t of g.tasks) set.add(str(t.status) ?? "unknown");
    return [...set].sort();
  }, [groups]);

  const totalTasks = useMemo(() => filteredGroups.reduce((n, g) => n + g.tasks.length, 0), [filteredGroups]);
  const selected = useMemo(
    () => filteredGroups.find((g) => g.patient.id === selectedId) ?? filteredGroups[0] ?? null,
    [filteredGroups, selectedId],
  );

  // Outcome loop: the vitals still abnormal on the selected patient's LATEST reading.
  // Each alert-task uses this to show whether its vital has since improved. null only
  // when nothing is selected.
  const activeAlertVitals = useMemo(() => (selected ? selected.outcomeVitals : null), [selected]);

  /** Patch a task in place after TaskCard mutates it (status / notes). */
  const onTaskChanged = (updated: FhirResource) =>
    setGroups((gs) =>
      gs.map((g) => ({
        ...g,
        tasks: g.tasks.map((t) => (str(t.id) === str(updated.id) ? updated : t)),
      })),
    );

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100vh" }}>
      {/* Top app bar: spans the full main width */}
      <Paper
        elevation={0}
        square
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 3,
          py: 1.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 700 }}>
          Tasks
        </Typography>
        {!loading && (
          <Chip
            size="small"
            label={`${totalTasks} across ${filteredGroups.length} patient(s)`}
            sx={{ bgcolor: "#f1f5f9" }}
          />
        )}
        {loadingMore && (
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, color: "text.secondary" }}>
            <CircularProgress size={14} />
            <Typography variant="caption">Loading more…</Typography>
          </Box>
        )}

        {/* Right side: status filter + refresh */}
        <FormControl size="small" sx={{ ml: "auto", minWidth: 170 }}>
          <InputLabel id="task-status-filter">Status</InputLabel>
          <Select
            labelId="task-status-filter"
            label="Status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
          >
            <MenuItem value="all">All statuses</MenuItem>
            {presentStatuses.map((s) => (
              <MenuItem key={s} value={s} sx={{ textTransform: "capitalize" }}>
                {s}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
        <Tooltip title="Refresh">
          <IconButton onClick={load} aria-label="Refresh tasks">
            <RefreshIcon />
          </IconButton>
        </Tooltip>
      </Paper>

      {error && (
        <Alert severity="error" onClose={() => setError(null)} sx={{ borderRadius: 0 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
          <CircularProgress />
        </Box>
      ) : groups.length === 0 ? (
        <Box sx={{ p: 3 }}>
          <Alert severity="info" icon={<AssignmentIcon />}>
            No tasks yet. Tasks are created when a clinician accepts a GDMT gap or a remote-monitoring alert.
          </Alert>
        </Box>
      ) : (
        <Box sx={{ display: "flex", flexGrow: 1, minHeight: 0 }}>
          {/* Left third: patients with tasks */}
          <Box
            sx={{
              width: "33.333%",
              flexShrink: 0,
              borderRight: "1px solid",
              borderColor: "divider",
              overflowY: "auto",
              bgcolor: "background.paper",
            }}
          >
            {filteredGroups.length === 0 && (
              <Typography variant="body2" color="text.secondary" sx={{ p: 2.5 }}>
                No tasks match this status.
              </Typography>
            )}
            {filteredGroups.map((g) => {
              const c = avatarColors(g.patient);
              const active = g.patient.id === selectedId;
              return (
                <Box
                  key={g.patient.id}
                  onClick={() => setSelectedId(g.patient.id ?? null)}
                  sx={{
                    display: "flex",
                    alignItems: "center",
                    gap: 1.5,
                    px: 2.5,
                    py: 1.75,
                    cursor: "pointer",
                    borderBottom: "1px solid",
                    borderColor: "divider",
                    borderLeft: "3px solid",
                    borderLeftColor: active ? "primary.main" : "transparent",
                    bgcolor: active ? "#f1f5f9" : "transparent",
                    "&:hover": { bgcolor: active ? "#f1f5f9" : "#f8fafc" },
                  }}
                >
                  <Avatar sx={{ bgcolor: c.bg, color: c.fg, width: 40, height: 40, fontWeight: 700 }}>
                    {initialsOf(g.patient)}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
                      {fullName(g.patient)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      MRN {mrnOf(g.patient)}
                    </Typography>
                  </Box>
                  <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
                    <Tooltip title={`HF risk ${g.risk.score}/100`}>
                      <Chip
                        size="small"
                        label={`Risk ${g.risk.score}`}
                        sx={{ bgcolor: RISK_COLOR[g.risk.band].bg, color: RISK_COLOR[g.risk.band].fg, fontWeight: 700 }}
                      />
                    </Tooltip>
                    <Chip size="small" label={`${g.tasks.length} task(s)`} variant="outlined" />
                  </Box>
                </Box>
              );
            })}
          </Box>

          {/* Right two-thirds: selected patient's tasks + actions */}
          <Box sx={{ flexGrow: 1, overflowY: "auto", p: 3 }}>
            {!selected ? (
              <Typography color="text.secondary">Select a patient to view their tasks.</Typography>
            ) : (
              <>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2.5 }}>
                  <Box sx={{ flexGrow: 1 }}>
                    <Typography variant="h6" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                      {fullName(selected.patient)}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      MRN {mrnOf(selected.patient)} · {selected.tasks.length} task(s)
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    variant="outlined"
                    endIcon={<LaunchIcon />}
                    onClick={() => navigate(`/patients/${selected.patient.id}/vitals`)}
                  >
                    Open chart
                  </Button>
                </Box>

                <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {selected.tasks.map((t) => (
                    <TaskCard
                      key={str(t.id)}
                      task={t}
                      patientId={selected.patient.id ?? ""}
                      activeAlertVitals={activeAlertVitals}
                      onChanged={onTaskChanged}
                    />
                  ))}
                </Box>
              </>
            )}
          </Box>
        </Box>
      )}
    </Box>
  );
}
