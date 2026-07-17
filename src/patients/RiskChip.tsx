import { Box, Chip, CircularProgress } from "@mui/material";
import type { RiskScore } from "../engine/risk";
import { RISK_COLOR } from "./riskColors";

/**
 * Compact risk indicator for table rows: a band-colored chip like "67 · High".
 * `loading` shows a small spinner (score still resolving); a null/undefined `risk`
 * with no loading renders an em dash (e.g. non-HF patients, who get no score).
 */
export function RiskChip({ risk, loading }: { risk?: RiskScore; loading?: boolean }) {
  if (risk) {
    const c = RISK_COLOR[risk.band];
    return (
      <Chip
        size="small"
        label={`${risk.score} · ${risk.band}`}
        sx={{ bgcolor: c.bg, color: c.fg, fontWeight: 700 }}
      />
    );
  }
  if (loading) {
    return (
      <Box sx={{ display: "inline-flex", alignItems: "center" }}>
        <CircularProgress size={16} thickness={5} sx={{ color: "text.disabled" }} />
      </Box>
    );
  }
  return <Box component="span" sx={{ color: "text.disabled" }}>—</Box>;
}
