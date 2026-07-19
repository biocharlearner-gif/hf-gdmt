import type { RiskBand } from "../engine/risk";

/**
 * Single source of truth for HF risk-band colors. Used by the Vitals tab risk panel,
 * the Tasks page, and the Patient List risk chip so the same band always reads the
 * same color across the app.
 */
export const RISK_COLOR: Record<RiskBand, { fg: string; bg: string }> = {
  Critical: { fg: "#b91c1c", bg: "#fee2e2" },
  High: { fg: "#c2410c", bg: "#ffedd5" },
  Moderate: { fg: "#b45309", bg: "#fef3c7" },
  Low: { fg: "#0369a1", bg: "#e0f2fe" },
  Stable: { fg: "#15803d", bg: "#dcfce7" },
};
