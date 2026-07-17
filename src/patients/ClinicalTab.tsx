import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import {
  Alert,
  Box,
  Chip,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Tab,
  Tabs,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from "@mui/material";
import AssignmentIcon from "@mui/icons-material/AssignmentOutlined";
import MedicationIcon from "@mui/icons-material/MedicationOutlined";
import ScienceIcon from "@mui/icons-material/ScienceOutlined";
import { getConditions, getLabObservations, getMedications } from "./patientApi";
import {
  summarizeCondition,
  summarizeMedication,
  PILLAR_SHORT,
  type Activity,
  type ProblemSummary,
  type MedicationSummary,
} from "./clinicalData";
import { buildLabSeries, fmtLabValue, type LabFlag, type LabSeries } from "./labs";
import { Card, EmptyState, Loading } from "./ui";
import { Line } from "./sparkline";
import { fmtDay, round1 } from "./format";

/**
 * Clinical tab — the chart-review surface: Problem List, Medications, and lab history.
 *
 * Problems and Medications each carry an Active / Resolved toggle (Active by default);
 * the underlying queries stay unfiltered so toggling never re-fetches. Labs render the
 * GDMT-relevant panel as trends, because the engine gates every pillar on the *latest*
 * K+/eGFR/LVEF and a clinician can only judge that number against its trajectory.
 *
 * This tab displays and flags; it never recommends. Recommendations live in the GDMT
 * tab, which is driven by the pure engine.
 */

type View = "problems" | "medications" | "labs";

const VIEWS: { value: View; label: string }[] = [
  { value: "problems", label: "Problems" },
  { value: "medications", label: "Medications" },
  { value: "labs", label: "Labs" },
];

const CLINICAL_STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  active: { bg: "#dcfce7", fg: "#15803d" },
  recurrence: { bg: "#dcfce7", fg: "#15803d" },
  relapse: { bg: "#dcfce7", fg: "#15803d" },
  inactive: { bg: "#f1f5f9", fg: "#475569" },
  remission: { bg: "#f1f5f9", fg: "#475569" },
  resolved: { bg: "#f1f5f9", fg: "#475569" },
};

const MED_STATUS_STYLE: Record<string, { bg: string; fg: string }> = {
  active: { bg: "#dcfce7", fg: "#15803d" },
  "on-hold": { bg: "#fef3c7", fg: "#b45309" },
  draft: { bg: "#f1f5f9", fg: "#475569" },
  stopped: { bg: "#fee2e2", fg: "#b91c1c" },
  cancelled: { bg: "#fee2e2", fg: "#b91c1c" },
  completed: { bg: "#f1f5f9", fg: "#475569" },
};

const LAB_FLAG_STYLE: Record<LabFlag, { bg: string; fg: string; label: string }> = {
  low: { bg: "#e0eaff", fg: "#3056d3", label: "Low" },
  high: { bg: "#fee2e2", fg: "#b91c1c", label: "High" },
  normal: { bg: "#cdf5e4", fg: "#0d9488", label: "Normal" },
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Active | Resolved switch. Counts are shown so an empty pane explains itself. */
function ActivityToggle({
  value,
  onChange,
  counts,
}: {
  value: Activity;
  onChange: (a: Activity) => void;
  counts: Record<Activity, number>;
}) {
  return (
    <ToggleButtonGroup
      size="small"
      exclusive
      value={value}
      onChange={(_, v: Activity | null) => v && onChange(v)}
      aria-label="Filter by status"
    >
      <ToggleButton value="active" sx={{ textTransform: "none", px: 1.5 }}>
        Active ({counts.active})
      </ToggleButton>
      <ToggleButton value="resolved" sx={{ textTransform: "none", px: 1.5 }}>
        Resolved ({counts.resolved})
      </ToggleButton>
    </ToggleButtonGroup>
  );
}

function countByActivity<T extends { activity: Activity }>(rows: T[]): Record<Activity, number> {
  return {
    active: rows.filter((r) => r.activity === "active").length,
    resolved: rows.filter((r) => r.activity === "resolved").length,
  };
}

/** Shared row chrome for the problem / medication lists. */
function ListRow({ primary, secondary, chip }: { primary: string; secondary?: string; chip?: ReactNode }) {
  return (
    <Box
      sx={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 1,
        pb: 1.25,
        borderBottom: "1px solid",
        borderColor: "divider",
        "&:last-of-type": { borderBottom: 0, pb: 0 },
      }}
    >
      <Box sx={{ minWidth: 0 }}>
        <Typography variant="body1" sx={{ fontWeight: 600 }}>
          {primary}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {secondary || "—"}
        </Typography>
      </Box>
      {chip}
    </Box>
  );
}

// ---- Problems ---------------------------------------------------------------

function ProblemsSection({ problems }: { problems: ProblemSummary[] | null }) {
  const [activity, setActivity] = useState<Activity>("active");
  if (problems === null) return <Card title="Problem List"><Loading /></Card>;

  const counts = countByActivity(problems);
  const rows = problems.filter((p) => p.activity === activity);

  return (
    <Card
      title="Problem List"
      action={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <ActivityToggle value={activity} onChange={setActivity} counts={counts} />
          <AssignmentIcon fontSize="small" color="primary" />
        </Box>
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No {activity} conditions recorded.</EmptyState>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {rows.map((c) => {
            const style = CLINICAL_STATUS_STYLE[c.clinicalStatus ?? ""] ?? { bg: "#e0eaff", fg: "#3056d3" };
            const onset = c.onset ? ` · onset ${fmtDay(c.onset)}` : "";
            return (
              <ListRow
                key={c.id}
                primary={c.display}
                secondary={`${c.code ?? "—"}${c.verificationStatus ? ` · ${c.verificationStatus}` : ""}${onset}`}
                chip={
                  c.clinicalStatus ? (
                    <Chip
                      size="small"
                      label={c.clinicalStatus}
                      sx={{ bgcolor: style.bg, color: style.fg, fontWeight: 700, textTransform: "capitalize", flexShrink: 0 }}
                    />
                  ) : undefined
                }
              />
            );
          })}
        </Box>
      )}
    </Card>
  );
}

// ---- Medications ------------------------------------------------------------

function MedicationsSection({ meds }: { meds: MedicationSummary[] | null }) {
  const [activity, setActivity] = useState<Activity>("active");
  if (meds === null) return <Card title="Medications"><Loading /></Card>;

  const counts = countByActivity(meds);
  const rows = meds.filter((m) => m.activity === activity);

  return (
    <Card
      title="Medications"
      action={
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <ActivityToggle value={activity} onChange={setActivity} counts={counts} />
          <MedicationIcon fontSize="small" color="primary" />
        </Box>
      }
    >
      {rows.length === 0 ? (
        <EmptyState>No {activity} medications recorded.</EmptyState>
      ) : (
        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
          {rows.map((m) => {
            const style = MED_STATUS_STYLE[m.status ?? ""] ?? { bg: "#e0eaff", fg: "#3056d3" };
            const detail = [m.dose, m.statusReason].filter(Boolean).join(" · ");
            return (
              <ListRow
                key={m.id}
                primary={m.name}
                secondary={detail}
                chip={
                  <Box sx={{ display: "flex", gap: 0.75, flexShrink: 0 }}>
                    {m.pillar && (
                      <Chip
                        size="small"
                        label={PILLAR_SHORT[m.pillar]}
                        sx={{ bgcolor: "#eef2ff", color: "#3730a3", fontWeight: 700 }}
                      />
                    )}
                    {m.status && (
                      <Chip
                        size="small"
                        label={m.status}
                        sx={{ bgcolor: style.bg, color: style.fg, fontWeight: 700, textTransform: "capitalize" }}
                      />
                    )}
                  </Box>
                }
              />
            );
          })}
        </Box>
      )}
    </Card>
  );
}

// ---- Labs -------------------------------------------------------------------

function LabTrendCard({ series }: { series: LabSeries }) {
  const { def, latest, deltaPct, points } = series;
  const flag = latest?.flag ?? "normal";
  const style = LAB_FLAG_STYLE[flag];
  const color = flag === "normal" ? "#1d4ed8" : "#b91c1c";
  const range =
    def.refLow !== undefined && def.refHigh !== undefined
      ? `Ref ${def.refLow}–${def.refHigh} ${def.unit}`
      : def.refLow !== undefined
        ? `Ref ≥ ${def.refLow} ${def.unit}`
        : def.refHigh !== undefined
          ? `Ref ≤ ${def.refHigh} ${def.unit}`
          : "";

  return (
    <Box sx={{ p: 2, border: "1px solid", borderColor: "divider", borderRadius: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 1 }}>
        <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>
          {def.label}
        </Typography>
        {latest && (
          <Chip size="small" label={style.label} sx={{ bgcolor: style.bg, color: style.fg, fontWeight: 700 }} />
        )}
      </Box>

      {latest ? (
        <>
          <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
            <Typography variant="h4" sx={{ fontWeight: 700, color: flag === "normal" ? "text.primary" : "#b91c1c" }}>
              {fmtLabValue(def, latest.value)}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              {latest.unit}
            </Typography>
            {deltaPct !== null && (
              <Typography variant="caption" sx={{ ml: 0.5, fontWeight: 700, color: "text.secondary" }}>
                {/* Below 0.05% rounds to "0.0%", where a direction arrow would be noise. */}
                {Math.abs(deltaPct) < 0.05 ? "No change" : `${deltaPct > 0 ? "▲" : "▼"} ${Math.abs(round1(deltaPct))}%`}
              </Typography>
            )}
          </Box>
          <Line series={points.map((p) => p.value)} color={color} />
          <Typography variant="caption" sx={{ display: "block", mt: 1, color: "text.secondary" }}>
            {points.length} result{points.length === 1 ? "" : "s"} · latest {fmtDay(latest.date)}
            {range ? ` · ${range}` : ""}
          </Typography>
        </>
      ) : (
        <Box sx={{ py: 2 }}>
          <EmptyState>No results on file.</EmptyState>
        </Box>
      )}

      <Typography variant="caption" sx={{ display: "block", mt: 1, fontStyle: "italic", color: "text.secondary" }}>
        {def.gdmtNote}
      </Typography>
    </Box>
  );
}

/**
 * `now` is captured once when the data loads and passed in, rather than read during
 * render: a `Date.now()` in the render path makes the window silently shift underneath
 * the user on any unrelated re-render. Same reason the engine takes an injected `now`.
 */
function LabsSection({ labs, now }: { labs: LabSeries[] | null; now: number | null }) {
  const [windowDays, setWindowDays] = useState<90 | 365>(365);

  const windowed = useMemo(() => {
    if (!labs || now === null) return null;
    const cutoff = now - windowDays * DAY_MS;
    return labs.map((s) => {
      const points = s.points.filter((p) => {
        const t = new Date(p.date).getTime();
        return Number.isNaN(t) || t >= cutoff;
      });
      const latest = points[points.length - 1];
      const prev = points[points.length - 2];
      return {
        ...s,
        points,
        latest,
        deltaPct: latest && prev && prev.value !== 0 ? ((latest.value - prev.value) / prev.value) * 100 : null,
      } satisfies LabSeries;
    });
  }, [labs, windowDays, now]);

  if (windowed === null) return <Card title="Lab Results"><Loading /></Card>;

  const history = windowed
    .flatMap((s) => s.points.map((p) => ({ ...p, label: s.def.label, text: fmtLabValue(s.def, p.value) })))
    .sort((a, b) => b.date.localeCompare(a.date));

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      <Card
        title="Lab Results"
        action={
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={windowDays}
              onChange={(_, v: 90 | 365 | null) => v && setWindowDays(v)}
              aria-label="Lab history window"
            >
              <ToggleButton value={90} sx={{ textTransform: "none", px: 1.5 }}>
                90 days
              </ToggleButton>
              <ToggleButton value={365} sx={{ textTransform: "none", px: 1.5 }}>
                12 months
              </ToggleButton>
            </ToggleButtonGroup>
            <ScienceIcon fontSize="small" color="primary" />
          </Box>
        }
      >
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))", gap: 2 }}>
          {windowed.map((s) => (
            <LabTrendCard key={s.def.key} series={s} />
          ))}
        </Box>
      </Card>

      <Card title="Result History">
        {history.length === 0 ? (
          <EmptyState>No lab results in this window.</EmptyState>
        ) : (
          <TableContainer>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell sx={{ fontWeight: 700 }}>Date</TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Test</TableCell>
                  <TableCell sx={{ fontWeight: 700 }} align="right">
                    Result
                  </TableCell>
                  <TableCell sx={{ fontWeight: 700 }}>Flag</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {history.map((r, i) => {
                  const style = LAB_FLAG_STYLE[r.flag];
                  return (
                    <TableRow key={`${r.label}-${r.date}-${i}`}>
                      <TableCell>{fmtDay(r.date)}</TableCell>
                      <TableCell>{r.label}</TableCell>
                      <TableCell align="right">
                        {r.text} {r.unit}
                      </TableCell>
                      <TableCell>
                        <Chip
                          size="small"
                          label={style.label}
                          sx={{ bgcolor: style.bg, color: style.fg, fontWeight: 700 }}
                        />
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </TableContainer>
        )}
      </Card>
    </Box>
  );
}

// ---- Main component ---------------------------------------------------------

export default function ClinicalTab() {
  const { id = "" } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();

  const raw = searchParams.get("view");
  const view: View = VIEWS.some((v) => v.value === raw) ? (raw as View) : "problems";

  const [problems, setProblems] = useState<ProblemSummary[] | null>(null);
  const [meds, setMeds] = useState<MedicationSummary[] | null>(null);
  const [labs, setLabs] = useState<LabSeries[] | null>(null);
  /** Wall clock at load time, so the lab window is stable across re-renders. */
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    Promise.all([getConditions(id), getMedications(id), getLabObservations(id)])
      .then(([cs, ms, ls]) => {
        setProblems(cs.map(summarizeCondition));
        setMeds(ms.map(summarizeMedication));
        setLabs(buildLabSeries(ls));
        setLoadedAt(Date.now());
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load clinical data"));
  }, [id]);

  useEffect(() => {
    // Data-fetching effect; the synchronous state reset is the documented exception.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (error) return <Alert severity="error">{error}</Alert>;

  return (
    <Box>
      <Tabs
        value={view}
        onChange={(_, v: View) => setSearchParams({ view: v }, { replace: true })}
        sx={{ mb: 3, borderBottom: "1px solid", borderColor: "divider" }}
      >
        {VIEWS.map((v) => (
          <Tab key={v.value} value={v.value} label={v.label} sx={{ textTransform: "none", fontWeight: 600 }} />
        ))}
      </Tabs>

      {view === "problems" && <ProblemsSection problems={problems} />}
      {view === "medications" && <MedicationsSection meds={meds} />}
      {view === "labs" && <LabsSection labs={labs} now={loadedAt} />}
    </Box>
  );
}
