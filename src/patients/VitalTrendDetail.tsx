import { useEffect, useState } from "react";
import { Box, CircularProgress, Table, TableBody, TableCell, TableHead, TableRow, Typography } from "@mui/material";
import { getObservations } from "./patientApi";

/**
 * Lazy, reusable trend + reading-history panel for ONE vital. Rendered only when a
 * Task card is expanded, so observations are fetched on demand (not up front). Used by
 * both the global Tasks page and the patient-view Tasks tab.
 */

type VitalKey = "weight" | "bloodPressure" | "heartRate" | "spo2";

interface Coding { code?: string }
interface Obs {
  id?: string;
  effectiveDateTime?: string;
  issued?: string;
  code?: { coding?: Coding[] };
  valueQuantity?: { value?: number; unit?: string };
  component?: unknown[];
}

const META: Record<VitalKey, { codes: string[]; label: string; unit: string }> = {
  weight: { codes: ["29463-7", "3141-9", "8350-1"], label: "Weight", unit: "kg" },
  bloodPressure: { codes: ["8480-6"], label: "Systolic BP", unit: "mmHg" },
  heartRate: { codes: ["8867-4"], label: "Heart Rate", unit: "bpm" },
  spo2: { codes: ["59408-5", "2708-6"], label: "SpO₂", unit: "%" },
};
const BP_PANEL = "85354-9";

interface Reading { value: number; date: string }

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function fmt(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

function seriesFor(obs: Obs[], codes: string[]): Reading[] {
  return obs
    .filter((o) => {
      const cs = (o.code?.coding ?? []).map((c) => c.code ?? "");
      return cs.some((c) => codes.includes(c)) && !cs.includes(BP_PANEL);
    })
    .map((o) => ({ value: o.valueQuantity?.value, date: o.effectiveDateTime ?? o.issued }))
    .filter((r): r is Reading => typeof r.value === "number" && typeof r.date === "string")
    .sort((a, b) => a.date.localeCompare(b.date));
}

function Line({ series }: { series: number[] }) {
  if (series.length < 2) return null;
  const w = 480, h = 60, pad = 4;
  const min = Math.min(...series), max = Math.max(...series), span = max - min || 1;
  const step = (w - pad * 2) / (series.length - 1);
  const pts = series.map((v, i) => `${round1(pad + i * step)},${round1(pad + (h - pad * 2) * (1 - (v - min) / span))}`);
  return (
    <Box sx={{ mt: 1 }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <polyline points={`${pad},${h - pad} ${pts.join(" ")} ${w - pad},${h - pad}`} fill="#2563eb1a" stroke="none" />
        <polyline points={pts.join(" ")} fill="none" stroke="#2563eb" strokeWidth={2} />
      </svg>
    </Box>
  );
}

export default function VitalTrendDetail({ patientId, vital }: { patientId: string; vital: VitalKey }) {
  const meta = META[vital];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [series, setSeries] = useState<Reading[]>([]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getObservations(patientId)
      .then((obs) => {
        if (cancelled) return;
        setSeries(seriesFor(obs as unknown as Obs[], meta.codes));
      })
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Failed to load readings"))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [patientId, vital, meta.codes]);

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
        <CircularProgress size={20} />
      </Box>
    );
  }
  if (error) return <Typography variant="caption" color="error">{error}</Typography>;
  if (series.length === 0) return <Typography variant="caption" color="text.secondary">No {meta.label} readings on file.</Typography>;

  const recent = [...series].reverse().slice(0, 8);
  return (
    <Box>
      <Typography variant="overline" color="text.secondary">{meta.label} trend</Typography>
      <Line series={series.map((r) => r.value)} />
      <Table size="small" sx={{ mt: 1 }}>
        <TableHead>
          <TableRow>
            <TableCell>Timestamp</TableCell>
            <TableCell align="right">Reading</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {recent.map((r, i) => (
            <TableRow key={i}>
              <TableCell sx={{ whiteSpace: "nowrap" }}>{fmt(r.date)}</TableCell>
              <TableCell align="right">
                <strong>{round1(r.value)}</strong> {meta.unit}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Box>
  );
}
