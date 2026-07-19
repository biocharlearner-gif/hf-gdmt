import { Box } from "@mui/material";
import { round1 } from "./format";

/**
 * Inline mini-charts. Extracted from VitalsTab once the Labs view needed the same trend
 * rendering — the project has no charting dependency, and these two SVG primitives have
 * covered every case so far.
 */

/** Bar sparkline; the most recent half is drawn at full opacity. */
export function Bars({ series, color }: { series: number[]; color: string }) {
  if (series.length === 0) return null;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  return (
    <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5, height: 64, mt: 1 }}>
      {series.map((v, i) => {
        const h = 18 + ((v - min) / span) * 42; // 18–60px
        const recent = i >= series.length - Math.ceil(series.length / 2);
        return <Box key={i} sx={{ flex: 1, height: h, borderRadius: 0.75, bgcolor: recent ? color : `${color}40` }} />;
      })}
    </Box>
  );
}

/** Filled line sparkline. */
export function Line({ series, color }: { series: number[]; color: string }) {
  if (series.length === 0) return null;
  const w = 240;
  const h = 64;
  const pad = 4;
  const min = Math.min(...series);
  const max = Math.max(...series);
  const span = max - min || 1;
  const step = series.length > 1 ? (w - pad * 2) / (series.length - 1) : 0;
  const pts = series.map((v, i) => `${round1(pad + i * step)},${round1(pad + (h - pad * 2) * (1 - (v - min) / span))}`);
  return (
    <Box sx={{ mt: 1, height: 64 }}>
      <svg width="100%" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ display: "block" }}>
        <polyline points={`${pad},${h - pad} ${pts.join(" ")} ${w - pad},${h - pad}`} fill={`${color}1a`} stroke="none" />
        <polyline points={pts.join(" ")} fill="none" stroke={color} strokeWidth={2} />
      </svg>
    </Box>
  );
}
