import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Menu,
  MenuItem,
  Paper,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Tooltip,
  Typography,
} from "@mui/material";
import ErrorOutlineIcon from "@mui/icons-material/ErrorOutlineOutlined";
import InfoOutlinedIcon from "@mui/icons-material/InfoOutlined";
import ScaleIcon from "@mui/icons-material/MonitorWeightOutlined";
import BloodtypeIcon from "@mui/icons-material/BloodtypeOutlined";
import FavoriteIcon from "@mui/icons-material/FavoriteBorder";
import AirIcon from "@mui/icons-material/AirOutlined";
import FilterListIcon from "@mui/icons-material/FilterList";
import FileDownloadIcon from "@mui/icons-material/FileDownloadOutlined";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import PendingIcon from "@mui/icons-material/PendingOutlined";
import NorthIcon from "@mui/icons-material/North";
import SouthIcon from "@mui/icons-material/South";
import EastIcon from "@mui/icons-material/East";
import { getObservations, getTasksForPatient, getEncounters, createResourceIfNoneExist, type FhirResource } from "./patientApi";
import { buildAlertInput, buildHospitalizationSignal } from "../fhir/extract";
import { evaluateAlerts, type GdmtAlert, type AlertSeverity } from "../engine/alerts";
import { computeRiskScore, RISK_SCORING, type HospitalizationSignal } from "../engine/risk";
import { buildDetectedIssue, buildFlagForAlert, buildTaskForAlert, alertKey, ALERT_IDENTIFIER_SYSTEM } from "../fhir/writeback";
import { CURRENT_USER } from "./currentUser";
import { RISK_COLOR } from "./riskColors";
import CitationLine from "./CitationLine";
import { Bars, Line } from "./sparkline";
import { fmtDate, fmtTime, round1 } from "./format";

/**
 * Vitals page — remote-monitoring view for a patient's home-device readings.
 *
 * Three zones: (1) cited alert banners from the pure `evaluateAlerts` engine, with
 * Acknowledge → DetectedIssue+Flag+Task writeback; (2) historical trend cards per
 * vital with a 7/30-day window; (3) a unified reading-history table plus a detailed
 * blood-pressure log (FHIR BP panels). The engine only detects & cites; a clinician
 * acknowledges before anything is written.
 */

// ---- FHIR helpers -----------------------------------------------------------

interface Coding { code?: string; display?: string }
interface Quantity { value?: number; unit?: string }
interface Range { low?: Quantity; high?: Quantity }
interface Component { code?: { coding?: Coding[] }; valueQuantity?: Quantity; referenceRange?: Range[] }
interface Obs {
  id?: string;
  effectiveDateTime?: string;
  issued?: string;
  code?: { coding?: Coding[]; text?: string };
  valueQuantity?: Quantity;
  component?: Component[];
  device?: { display?: string };
  note?: { text?: string }[];
}

const WEIGHT = ["29463-7", "3141-9", "8350-1"];
const SBP = ["8480-6"];
const HR = ["8867-4"];
const SPO2 = ["59408-5", "2708-6"];
const BP_PANEL = "85354-9";
const DAY_MS = 24 * 60 * 60 * 1000;

type VitalKey = "weight" | "bloodPressure" | "heartRate" | "spo2";

interface Reading {
  value: number;
  unit: string;
  date: string;
}

function obsCodes(o: Obs): string[] {
  return (o.code?.coding ?? []).map((c) => c.code ?? "").filter(Boolean);
}
function hasCode(o: Obs, set: readonly string[]): boolean {
  return obsCodes(o).some((c) => set.includes(c));
}
function obsDate(o: Obs): string | undefined {
  return o.effectiveDateTime ?? o.issued;
}
function seriesFor(obs: Obs[], set: readonly string[]): Reading[] {
  return obs
    .filter((o) => hasCode(o, set) && !hasCode(o, [BP_PANEL]))
    .map((o) => ({ value: o.valueQuantity?.value, unit: o.valueQuantity?.unit ?? "", date: obsDate(o) }))
    .filter((r): r is Reading => typeof r.value === "number" && typeof r.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date));
}
function compOf(o: Obs, set: readonly string[]): Component | undefined {
  return (o.component ?? []).find((c) => (c.code?.coding ?? []).some((x) => x.code && set.includes(x.code)));
}

// ---- Status / classification ------------------------------------------------

type Status = "CRITICAL" | "HIGH" | "ELEVATED" | "FRESH" | "STABLE" | "NORMAL";

const STATUS_STYLE: Record<Status, { bg: string; fg: string }> = {
  CRITICAL: { bg: "#fee2e2", fg: "#b91c1c" },
  HIGH: { bg: "#fee2e2", fg: "#b91c1c" },
  ELEVATED: { bg: "#e0eaff", fg: "#3056d3" },
  FRESH: { bg: "#cdf5e4", fg: "#0d9488" },
  STABLE: { bg: "#e2eefc", fg: "#3056d3" },
  NORMAL: { bg: "#cdf5e4", fg: "#0d9488" },
};

/** Is a single reading out of safe range for its vital? */
function abnormal(type: VitalKey, v: number): boolean {
  if (type === "spo2") return v < 90;
  if (type === "bloodPressure") return v < 90 || v > 140;
  if (type === "heartRate") return v < 50 || v > 100;
  return false; // weight is judged by trend, not a single value
}
function sysStatus(v: number): Status {
  return v >= 140 ? "HIGH" : v >= 120 ? "ELEVATED" : "NORMAL";
}
function diaStatus(v: number): Status {
  return v >= 90 ? "HIGH" : v >= 80 ? "ELEVATED" : "NORMAL";
}

// ---- Trend card -------------------------------------------------------------

interface CardConfig {
  key: VitalKey;
  label: string;
  unit: string;
  icon: ReactNode;
  chart: "bars" | "line";
  series: Reading[];
  caption: { text: string; tone: "good" | "bad" | "muted" };
}

function TrendCard({ cfg, alerted, refCb }: { cfg: CardConfig; alerted: boolean; refCb: (el: HTMLDivElement | null) => void }) {
  const values = cfg.series.map((r) => r.value);
  const latest = cfg.series[cfg.series.length - 1];
  const color = alerted ? "#b91c1c" : "#1d4ed8";
  const captionColor = cfg.caption.tone === "bad" ? "#b91c1c" : cfg.caption.tone === "good" ? "#0d9488" : "text.secondary";
  return (
    <Paper
      ref={refCb}
      variant="outlined"
      sx={{ borderRadius: 2, p: 2, borderColor: alerted ? "#b91c1c" : "divider", borderWidth: alerted ? 2 : 1 }}
    >
      <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <Typography variant="overline" sx={{ fontWeight: 700, color: alerted ? "#b91c1c" : "text.secondary" }}>
          {cfg.label}
        </Typography>
        <Box sx={{ color: alerted ? "#b91c1c" : "text.secondary", display: "flex" }}>{cfg.icon}</Box>
      </Box>
      <Box sx={{ display: "flex", alignItems: "baseline", gap: 0.5 }}>
        <Typography variant="h4" sx={{ fontWeight: 700, color: alerted ? "#b91c1c" : "text.primary" }}>
          {latest ? round1(latest.value) : "—"}
        </Typography>
        <Typography variant="body2" color="text.secondary">{cfg.unit}</Typography>
      </Box>
      {cfg.chart === "bars" ? <Bars series={values} color={color} /> : <Line series={values} color={color} />}
      <Typography variant="caption" sx={{ display: "block", mt: 1, fontWeight: 600, color: captionColor }}>
        {cfg.caption.text}
      </Typography>
    </Paper>
  );
}

// ---- Reading history row ----------------------------------------------------

interface HistoryRow {
  id: string;
  type: VitalKey;
  vitalLabel: string;
  value: number;
  unit: string;
  date: string;
  deltaPct: number | null;
  status: Status;
}

// ---- Main component ---------------------------------------------------------

export default function VitalsTab({ patientId: pid }: { patientId?: string } = {}) {
  const { id } = useParams();
  const patientId = pid ?? id ?? "";

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [observations, setObservations] = useState<Obs[]>([]);
  const [alerts, setAlerts] = useState<GdmtAlert[]>([]);
  const [windowDays, setWindowDays] = useState<7 | 30>(7);
  const [acting, setActing] = useState<string | null>(null);
  const [acked, setAcked] = useState<Record<string, string>>({});
  /** alertKeys that already have a Task on the server (so we don't create duplicates). */
  const [existingAlertKeys, setExistingAlertKeys] = useState<Set<string>>(new Set());
  /** Most recent HF inpatient stay, if any — a non-vital driver of the risk score. */
  const [hospitalization, setHospitalization] = useState<HospitalizationSignal | undefined>(undefined);
  const [historyFilter, setHistoryFilter] = useState<VitalKey | "all">("all");
  const [filterAnchor, setFilterAnchor] = useState<null | HTMLElement>(null);

  const cardRefs = useRef<Record<string, HTMLDivElement | null>>({});

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    Promise.all([
      getObservations(patientId),
      getTasksForPatient(patientId).catch(() => []),
      getEncounters(patientId).catch(() => [] as FhirResource[]),
    ])
      .then(([obs, tasks, encounters]) => {
        const typed = obs as unknown as Obs[];
        setObservations(typed);
        setAlerts(evaluateAlerts(buildAlertInput({ patientId, observations: obs })));
        setHospitalization(buildHospitalizationSignal({ encounters }));
        // Which alerts already have a Task? (identifier value "<key>:task")
        const keys = new Set<string>();
        for (const t of tasks) {
          for (const idf of ((t.identifier as { system?: string; value?: string }[] | undefined) ?? [])) {
            if (idf.system === ALERT_IDENTIFIER_SYSTEM && idf.value?.endsWith(":task")) {
              keys.add(idf.value.slice(0, -":task".length));
            }
          }
        }
        setExistingAlertKeys(keys);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load vitals"))
      .finally(() => setLoading(false));
  }, [patientId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  /** The Observation that triggered this alert (latest reading of its vital), for Task.focus. */
  const focusRefFor = (alert: GdmtAlert): string | undefined => {
    const setFor: Record<VitalKey, readonly string[]> = { weight: WEIGHT, bloodPressure: SBP, heartRate: HR, spo2: SPO2 };
    const last = alert.triggeredBy[alert.triggeredBy.length - 1];
    const match = observations.find((o) => hasCode(o, setFor[alert.vital]) && !hasCode(o, [BP_PANEL]) && obsDate(o) === last?.date);
    return match?.id ? `Observation/${match.id}` : undefined;
  };

  const acknowledge = async (alert: GdmtAlert) => {
    setActing(alert.id);
    const key = alertKey(`Patient/${patientId}`, alert);
    const q = (suffix: string) => `identifier=${ALERT_IDENTIFIER_SYSTEM}|${key}:${suffix}`;
    try {
      const opts = {
        patientRef: `Patient/${patientId}`,
        focusObservationRef: focusRefFor(alert),
        taskStatus: "accepted",
        ownerDisplay: CURRENT_USER.display,
      };
      // Conditional create → re-accepting the same alert never duplicates artifacts.
      await Promise.all([
        createResourceIfNoneExist(buildDetectedIssue(alert, opts) as FhirResource, q("issue")),
        createResourceIfNoneExist(buildFlagForAlert(alert, opts) as FhirResource, q("flag")),
        createResourceIfNoneExist(buildTaskForAlert(alert, opts) as FhirResource, q("task")),
      ]);
      setExistingAlertKeys((s) => new Set(s).add(key));
      setAcked((m) => ({ ...m, [alert.id]: "FHIR Task created (linked to the triggering Observation)" }));
    } catch (e) {
      setAcked((m) => ({ ...m, [alert.id]: e instanceof Error ? `Failed: ${e.message}` : "Failed" }));
    } finally {
      setActing(null);
    }
  };

  const reviewTrend = (vital: VitalKey) => {
    cardRefs.current[vital]?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // Build per-vital series within the selected window.
  const cutoff = Date.now() - windowDays * DAY_MS;
  const inWindow = (s: Reading[]) => s.filter((r) => new Date(r.date).getTime() >= cutoff);
  const weight = useMemo(() => inWindow(seriesFor(observations, WEIGHT)), [observations, windowDays]);
  const sbp = useMemo(() => inWindow(seriesFor(observations, SBP)), [observations, windowDays]);
  const hr = useMemo(() => inWindow(seriesFor(observations, HR)), [observations, windowDays]);
  const spo2 = useMemo(() => inWindow(seriesFor(observations, SPO2)), [observations, windowDays]);

  const alertedVitals = useMemo(() => new Set(alerts.map((a) => a.vital)), [alerts]);

  const cards: CardConfig[] = [
    { key: "weight", label: "WEIGHT", unit: "kg", icon: <ScaleIcon fontSize="small" />, chart: "bars", series: weight, caption: weightCaption(weight) },
    { key: "bloodPressure", label: "SYSTOLIC BP", unit: "mmHg", icon: <BloodtypeIcon fontSize="small" />, chart: "line", series: sbp, caption: sbpCaption(sbp) },
    { key: "heartRate", label: "HEART RATE", unit: "bpm", icon: <FavoriteIcon fontSize="small" />, chart: "line", series: hr, caption: hrCaption(hr) },
    { key: "spo2", label: "SPO2", unit: "%", icon: <AirIcon fontSize="small" />, chart: "bars", series: spo2, caption: spo2Caption(spo2) },
  ];

  // Unified reading-history rows (single-value vitals).
  const historyRows = useMemo<HistoryRow[]>(() => {
    const build = (s: Reading[], type: VitalKey, label: string): HistoryRow[] =>
      s.map((r, i) => {
        const prev = s[i - 1];
        const deltaPct = prev && prev.value !== 0 ? round1(((r.value - prev.value) / prev.value) * 100) : null;
        const isLatest = i === s.length - 1;
        const status: Status = abnormal(type, r.value) ? "CRITICAL" : isLatest ? "FRESH" : "STABLE";
        return { id: `${type}-${r.date}-${i}`, type, vitalLabel: label, value: r.value, unit: r.unit, date: r.date, deltaPct, status };
      });
    const rows = [
      ...build(weight, "weight", "Body Weight"),
      ...build(sbp, "bloodPressure", "Systolic BP"),
      ...build(hr, "heartRate", "Heart Rate"),
      ...build(spo2, "spo2", "Oxygen Saturation (SpO2)"),
    ].sort((a, b) => b.date.localeCompare(a.date));
    return historyFilter === "all" ? rows : rows.filter((r) => r.type === historyFilter);
  }, [weight, sbp, hr, spo2, historyFilter]);

  // Detailed BP panel log.
  const bpLog = useMemo(() => {
    return observations
      .filter((o) => hasCode(o, [BP_PANEL]))
      .map((o) => {
        const sys = compOf(o, ["8480-6"]);
        const dia = compOf(o, ["8462-4"]);
        const pulse = compOf(o, ["8867-4"]);
        return {
          id: o.id ?? obsDate(o) ?? Math.random().toString(),
          date: obsDate(o),
          sys: sys?.valueQuantity?.value,
          sysRange: sys?.referenceRange?.[0],
          dia: dia?.valueQuantity?.value,
          diaRange: dia?.referenceRange?.[0],
          pulse: pulse?.valueQuantity?.value,
          source: o.device?.display ?? "—",
          note: o.note?.[0]?.text ?? "",
        };
      })
      .filter((r) => typeof r.sys === "number")
      .sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
  }, [observations]);

  const exportCsv = () => {
    const header = ["Timestamp", "Vital Type", "Recorded Value", "Unit", "Trend %", "Status"];
    const lines = historyRows.map((r) =>
      [fmtDate(r.date), r.vitalLabel, r.value, r.unit, r.deltaPct ?? "", r.status].join(","),
    );
    const blob = new Blob([[header.join(","), ...lines].join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `vitals-${patientId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }
  if (error) return <Alert severity="error">{error}</Alert>;

  const risk = computeRiskScore(alerts, { hospitalization });

  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
      {/* 0. HF risk score */}
      <RiskPanel risk={risk} />

      {/* 1. Alert banners — once a Task exists for an alert, it moves to the Tasks tab,
             so we don't keep showing the banner here. */}
      {alerts
        .filter((a) => !existingAlertKeys.has(alertKey(`Patient/${patientId}`, a)))
        .map((a) => (
          <AlertBanner
            key={a.id}
            alert={a}
            acked={acked[a.id]}
            busy={acting === a.id}
            onAcknowledge={() => acknowledge(a)}
            onReviewTrend={() => reviewTrend(a.vital)}
          />
        ))}

      {/* 2. Historical trend mapping */}
      <Box>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1.5 }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Historical Trend Mapping
          </Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={windowDays}
            onChange={(_, v) => v && setWindowDays(v)}
          >
            <ToggleButton value={7} sx={{ textTransform: "none" }}>7 Days</ToggleButton>
            <ToggleButton value={30} sx={{ textTransform: "none" }}>30 Days</ToggleButton>
          </ToggleButtonGroup>
        </Box>
        <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2 }}>
          {cards.map((cfg) => (
            <TrendCard
              key={cfg.key}
              cfg={cfg}
              alerted={alertedVitals.has(cfg.key)}
              refCb={(el) => (cardRefs.current[cfg.key] = el)}
            />
          ))}
        </Box>
      </Box>

      {/* 3a. Detailed reading history */}
      <Paper variant="outlined" sx={{ borderRadius: 2 }}>
        <Box sx={{ display: "flex", alignItems: "center", px: 2.5, py: 1.75, borderBottom: "1px solid", borderColor: "divider" }}>
          <Typography variant="h6" sx={{ fontWeight: 700, flexGrow: 1 }}>
            Detailed Reading History
          </Typography>
          <Button size="small" color="inherit" startIcon={<FilterListIcon />} onClick={(e) => setFilterAnchor(e.currentTarget)}>
            {historyFilter === "all" ? "Filter" : labelForVital(historyFilter)}
          </Button>
          <Button size="small" color="inherit" startIcon={<FileDownloadIcon />} onClick={exportCsv}>
            Export CSV
          </Button>
          <Menu anchorEl={filterAnchor} open={Boolean(filterAnchor)} onClose={() => setFilterAnchor(null)}>
            {(["all", "weight", "bloodPressure", "heartRate", "spo2"] as const).map((k) => (
              <MenuItem
                key={k}
                selected={historyFilter === k}
                onClick={() => {
                  setHistoryFilter(k);
                  setFilterAnchor(null);
                }}
              >
                {k === "all" ? "All vitals" : labelForVital(k)}
              </MenuItem>
            ))}
          </Menu>
        </Box>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Timestamp</TableCell>
                <TableCell>Vital Type</TableCell>
                <TableCell>Recorded Value</TableCell>
                <TableCell>Trend Indicator</TableCell>
                <TableCell>Status</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {historyRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5}>
                    <Typography variant="body2" color="text.secondary">No readings in this window.</Typography>
                  </TableCell>
                </TableRow>
              ) : (
                historyRows.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ fontFeatureSettings: '"tnum"', whiteSpace: "nowrap" }}>{fmtDate(r.date)}</TableCell>
                    <TableCell sx={{ fontWeight: 600 }}>{r.vitalLabel}</TableCell>
                    <TableCell>
                      <Typography component="span" sx={{ fontWeight: 700, color: r.status === "CRITICAL" ? "#b91c1c" : "text.primary" }}>
                        {round1(r.value)}
                      </Typography>{" "}
                      <Typography component="span" variant="caption" color="text.secondary">{r.unit}</Typography>
                    </TableCell>
                    <TableCell><TrendIndicator deltaPct={r.deltaPct} critical={r.status === "CRITICAL"} /></TableCell>
                    <TableCell><StatusChip status={r.status} /></TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </TableContainer>
      </Paper>

      {/* 3b. Detailed blood-pressure log */}
      {bpLog.length > 0 && (
        <Paper variant="outlined" sx={{ borderRadius: 2 }}>
          <Box sx={{ px: 2.5, py: 1.75, borderBottom: "1px solid", borderColor: "divider" }}>
            <Typography variant="h6" sx={{ fontWeight: 700 }}>Blood Pressure Log</Typography>
          </Box>
          <TableContainer>
            <Table>
              <TableHead>
                <TableRow>
                  <TableCell>Date &amp; Time</TableCell>
                  <TableCell>Systolic</TableCell>
                  <TableCell>Diastolic</TableCell>
                  <TableCell>Pulse</TableCell>
                  <TableCell>Source</TableCell>
                  <TableCell>Notes</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {bpLog.map((r) => (
                  <TableRow key={r.id} hover>
                    <TableCell sx={{ whiteSpace: "nowrap" }}>{fmtDate(r.date)}</TableCell>
                    <TableCell><BpCell value={r.sys} range={r.sysRange} status={r.sys !== undefined ? sysStatus(r.sys) : "NORMAL"} /></TableCell>
                    <TableCell><BpCell value={r.dia} range={r.diaRange} status={r.dia !== undefined ? diaStatus(r.dia) : "NORMAL"} /></TableCell>
                    <TableCell>
                      <Typography component="span" sx={{ fontWeight: 700 }}>{r.pulse ?? "—"}</Typography>{" "}
                      <Typography component="span" variant="caption" color="text.secondary">BPM</Typography>
                    </TableCell>
                    <TableCell>{r.source}</TableCell>
                    <TableCell sx={{ maxWidth: 220, color: "text.secondary" }}>{r.note || "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </TableContainer>
        </Paper>
      )}

      {/* Architecture note for reviewers — how a reading becomes a cited alert */}
      <PipelinePanel />
    </Box>
  );
}

// ---- Sub-components ----------------------------------------------------------

/** Explains the device → Observation → Subscription → engine → writeback loop. */
function PipelinePanel() {
  const steps: { label: string; sub: string; live: boolean }[] = [
    { label: "Device reading", sub: "Connected scale / BP cuff / pulse-ox", live: true },
    { label: "FHIR Observation", sub: "Reading stored as an Observation", live: true },
    { label: "FHIR Subscription", sub: "Reacts to new Observation, notifies service", live: false },
    { label: "Alert engine", sub: "Pure evaluateAlerts() — detects & cites", live: true },
    { label: "Writeback", sub: "DetectedIssue + Flag + Task", live: true },
  ];
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5, bgcolor: "#f8fafc" }}>
      <Typography variant="subtitle2" sx={{ fontWeight: 700, mb: 0.5 }}>Remote-monitoring pipeline</Typography>
      <Typography variant="caption" color="text.secondary">
        The engine only detects and cites — a clinician accepts before anything is written. Thresholds are
        guideline-cited config constants (no in-app editing).
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1, mt: 1.5 }}>
        {steps.map((s, i) => (
          <Box key={s.label} sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, px: 1.25, py: 0.75, borderRadius: 1.5, bgcolor: "#fff", border: "1px solid", borderColor: "divider" }}>
              {s.live ? <CheckCircleIcon sx={{ fontSize: 16, color: "#16a34a" }} /> : <PendingIcon sx={{ fontSize: 16, color: "#b45309" }} />}
              <Box>
                <Typography variant="caption" sx={{ fontWeight: 700, display: "block", lineHeight: 1.2 }}>{s.label}</Typography>
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>{s.sub}</Typography>
              </Box>
            </Box>
            {i < steps.length - 1 && <Typography color="text.disabled">→</Typography>}
          </Box>
        ))}
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mt: 1.5 }}>
        <PendingIcon sx={{ fontSize: 12, color: "#b45309", verticalAlign: "middle" }} /> Subscription push is a
        deployment-level component (alongside CDS Hooks); in-app, the engine evaluates Observations on load.
      </Typography>
    </Paper>
  );
}

function RiskPanel({ risk }: { risk: ReturnType<typeof computeRiskScore> }) {
  const c = RISK_COLOR[risk.band];
  const citedRef = risk.contributors.find((x) => x.citationRef)?.citationRef;
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, display: "flex", alignItems: "center", gap: 2.5, borderColor: c.fg, borderWidth: risk.band === "Critical" || risk.band === "High" ? 2 : 1 }}>
      <Box sx={{ width: 72, height: 72, borderRadius: "50%", bgcolor: c.bg, color: c.fg, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <Typography variant="h4" sx={{ fontWeight: 800, lineHeight: 1 }}>{risk.score}</Typography>
        <Typography variant="caption" sx={{ fontWeight: 700 }}>/ 100</Typography>
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="overline" sx={{ fontWeight: 700, color: "text.secondary" }}>HF Risk Score</Typography>
          <Chip size="small" label={risk.band} sx={{ bgcolor: c.bg, color: c.fg, fontWeight: 800 }} />
          <Tooltip title={<RiskInfoContent />} arrow>
            <InfoOutlinedIcon sx={{ fontSize: 16, color: "text.disabled", cursor: "help" }} />
          </Tooltip>
        </Box>
        <Typography variant="body2" color="text.secondary">
          How concerning this patient's home vitals are right now (0–100; higher is worse).
        </Typography>

        {/* This patient's calculation — the exact contributors that sum to the score. */}
        {risk.contributors.length === 0 ? (
          <Typography variant="body2" sx={{ mt: 0.5, fontWeight: 600, color: c.fg }}>
            No active alerts → Stable (0).
          </Typography>
        ) : (
          <Box sx={{ mt: 0.5, display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>Driven by:</Typography>
            {risk.contributors.map((x, i) => (
              <Chip key={`${x.title}-${i}`} size="small" variant="outlined" label={`${x.title} +${x.points}`} sx={{ fontWeight: 600 }} />
            ))}
            <Typography variant="body2" color="text.secondary">= {risk.score} (capped at 100)</Typography>
          </Box>
        )}
        {citedRef && <CitationLine citationRef={citedRef} />}
      </Box>
    </Paper>
  );
}

/** Hover explanation for the risk score: what it is, the signals considered, and the formula. */
function RiskInfoContent() {
  const s = RISK_SCORING;
  return (
    <Box sx={{ p: 0.5, maxWidth: 320 }}>
      <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>What this is</Typography>
      <Typography variant="caption" sx={{ display: "block", opacity: 0.9 }}>
        A single 0–100 measure of how concerning this patient's home vitals are right now — used to triage
        the cohort sickest-first. Higher is worse.
      </Typography>

      <Divider sx={{ my: 0.75, borderColor: "rgba(255,255,255,0.25)" }} />

      <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>Factors considered</Typography>
      <Typography variant="caption" sx={{ display: "block", opacity: 0.9 }}>{s.factors.join(" · ")}</Typography>

      <Divider sx={{ my: 0.75, borderColor: "rgba(255,255,255,0.25)" }} />

      <Typography variant="caption" sx={{ fontWeight: 700, display: "block" }}>How it's calculated</Typography>
      <Typography variant="caption" sx={{ display: "block", opacity: 0.9 }}>
        Severity-weighted sum, capped at 100. Each alert adds High +{s.severityPoints.high} ·
        Moderate +{s.severityPoints.moderate} · Low +{s.severityPoints.low}; a recent HF hospitalization adds
        +{s.hospVulnerablePoints} (≤{s.hospVulnerableDays}d) or +{s.hospRecentPoints} (≤{s.hospRecentDays}d).
      </Typography>
      <Typography variant="caption" sx={{ display: "block", opacity: 0.9, mt: 0.5 }}>
        Bands: {s.bands.map((b) => `${b.band} ${b.range}`).join(" · ")}.
      </Typography>
    </Box>
  );
}

const SEVERITY_BADGE: Record<AlertSeverity, { label: string; bg: string }> = {
  high: { label: "CRITICAL ALERT", bg: "#b91c1c" },
  moderate: { label: "ALERT", bg: "#b45309" },
  low: { label: "NOTICE", bg: "#0369a1" },
};

function AlertBanner({
  alert,
  acked,
  busy,
  onAcknowledge,
  onReviewTrend,
}: {
  alert: GdmtAlert;
  acked?: string;
  busy: boolean;
  onAcknowledge: () => void;
  onReviewTrend: () => void;
}) {
  const badge = SEVERITY_BADGE[alert.severity];
  const reading = alert.triggeredBy[alert.triggeredBy.length - 1];
  const at = reading ? ` at ${fmtTime(reading.date)}` : "";
  const recorded = `Recorded ${alert.observed}${at} — reference ${alert.threshold}.`;
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, p: 2, display: "flex", alignItems: "center", gap: 2 }}>
      <Box sx={{ width: 36, height: 36, borderRadius: "50%", bgcolor: "#fee2e2", color: "#b91c1c", display: "flex", alignItems: "center", justifyContent: "center", flexShrink: 0 }}>
        <ErrorOutlineIcon fontSize="small" />
      </Box>
      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
          <Chip size="small" label={badge.label} sx={{ bgcolor: badge.bg, color: "#fff", fontWeight: 800, letterSpacing: "0.04em", height: 20 }} />
          <Chip
            size="small"
            variant="outlined"
            label={alert.kind === "trend" ? "Trend-based (predictive)" : "Threshold-based"}
            sx={{ height: 20, fontWeight: 600, borderColor: "divider", color: "text.secondary" }}
          />
          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{alert.title}</Typography>
        </Box>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.25 }}>{recorded}</Typography>
        <CitationLine citationRef={alert.citationRef} />
        {acked && (
          <Typography variant="caption" sx={{ color: acked.startsWith("Failed") ? "error.main" : "success.main" }}>{acked}</Typography>
        )}
      </Box>
      <Button color="primary" onClick={onReviewTrend} sx={{ fontWeight: 700 }}>Review Trend</Button>
      <Button variant="contained" disabled={busy || Boolean(acked)} onClick={onAcknowledge} sx={{ fontWeight: 700, whiteSpace: "nowrap" }}>
        {busy ? "Creating…" : acked ? "FHIR Task created" : "Accept + Create FHIR Task"}
      </Button>
    </Paper>
  );
}

function TrendIndicator({ deltaPct, critical }: { deltaPct: number | null; critical: boolean }) {
  if (deltaPct === null) {
    return (
      <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary" }}>
        <EastIcon sx={{ fontSize: 16 }} /> <Typography variant="body2">Stable</Typography>
      </Box>
    );
  }
  const up = deltaPct > 0;
  const flat = deltaPct === 0;
  const color = critical ? "#b91c1c" : "#0d9488";
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: flat ? "text.secondary" : color }}>
      {flat ? <EastIcon sx={{ fontSize: 16 }} /> : up ? <NorthIcon sx={{ fontSize: 16 }} /> : <SouthIcon sx={{ fontSize: 16 }} />}
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {up ? "+" : ""}{deltaPct}%
      </Typography>
    </Box>
  );
}

function StatusChip({ status }: { status: Status }) {
  const s = STATUS_STYLE[status];
  return <Chip size="small" label={status} sx={{ bgcolor: s.bg, color: s.fg, fontWeight: 700, letterSpacing: "0.03em" }} />;
}

function BpCell({ value, range, status }: { value?: number; range?: Range; status: Status }) {
  if (value === undefined) return <>—</>;
  const s = STATUS_STYLE[status];
  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        <Typography component="span" sx={{ fontWeight: 700 }}>{value}</Typography>
        <Chip size="small" label={status} sx={{ bgcolor: s.bg, color: s.fg, fontWeight: 700, height: 20 }} />
      </Box>
      {range?.low?.value !== undefined && range?.high?.value !== undefined && (
        <Typography variant="caption" color="text.secondary">RANGE: {range.low.value}–{range.high.value}</Typography>
      )}
    </Box>
  );
}

// ---- Caption helpers --------------------------------------------------------

function labelForVital(k: VitalKey): string {
  return k === "weight" ? "Weight" : k === "bloodPressure" ? "Systolic BP" : k === "heartRate" ? "Heart Rate" : "SpO2";
}

function weightCaption(s: Reading[]): CardConfig["caption"] {
  if (s.length < 2) return { text: "Insufficient data", tone: "muted" };
  const last = s[s.length - 1]!.value;
  const prev = s[s.length - 2]!.value;
  const d = round1(last - prev);
  return { text: `${d >= 0 ? "+" : ""}${d} kg / 24h`, tone: d > 0 ? "bad" : "good" };
}
function sbpCaption(s: Reading[]): CardConfig["caption"] {
  const last = s[s.length - 1]?.value;
  if (last === undefined) return { text: "No data", tone: "muted" };
  if (last < 90) return { text: "Below target (hypotension)", tone: "bad" };
  if (last > 140) return { text: "Above target", tone: "bad" };
  return { text: "In Target Range", tone: "good" };
}
function hrCaption(s: Reading[]): CardConfig["caption"] {
  if (s.length === 0) return { text: "No data", tone: "muted" };
  const vals = s.map((r) => r.value);
  const last = vals[vals.length - 1]!;
  if (last < 50) return { text: "Bradycardia", tone: "bad" };
  if (last > 100) return { text: "Tachycardia", tone: "bad" };
  const swing = Math.max(...vals) - Math.min(...vals);
  return { text: swing <= 10 ? "Stable (recent)" : "Variable", tone: "muted" };
}
function spo2Caption(s: Reading[]): CardConfig["caption"] {
  if (s.length < 2) return { text: s.length ? "Single reading" : "No data", tone: "muted" };
  const first = s[0]!.value;
  const last = s[s.length - 1]!.value;
  const pct = round1(((last - first) / first) * 100);
  if (last < 90) return { text: `${pct}% decline observed`, tone: "bad" };
  return { text: pct < 0 ? `${pct}% over window` : "Stable", tone: pct < 0 ? "bad" : "good" };
}
