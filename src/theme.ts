import { createTheme } from "@mui/material/styles";
import { BRAND_GRADIENT } from "./brand";

/**
 * "Clinical Precision" theme — a calm, authoritative medical design system.
 * Medical Blue primary on a cool, breathable off-white canvas; Healing Teal for
 * success; separation via low-contrast 1px outlines rather than heavy shadows.
 * Centralized here so every screen stays visually consistent.
 */
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#1d6fd6", light: "#4a90e2", dark: "#1a5fb8", contrastText: "#ffffff" },
    secondary: { main: "#18b6a6", light: "#5ed7ca", dark: "#0f8478", contrastText: "#ffffff" },
    success: { main: "#18b6a6", light: "#5eead4", contrastText: "#ffffff" },
    error: { main: "#ba1a1a", light: "#ffdad6", contrastText: "#ffffff" },
    warning: { main: "#b45309" },
    background: { default: "#f7f9fb", paper: "#ffffff" },
    text: { primary: "#191c1e", secondary: "#64748b" },
    divider: "#e2e8f0",
  },
  shape: { borderRadius: 8 },
  typography: {
    fontFamily: '"Inter", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
    h4: { fontWeight: 700, fontSize: "1.9rem", letterSpacing: "-0.02em" },
    h5: { fontWeight: 700, letterSpacing: "-0.01em" },
    h6: { fontWeight: 600 },
    subtitle1: { fontWeight: 600 },
    body2: { fontSize: "0.875rem" },
    button: { fontWeight: 600 },
    overline: { fontWeight: 600, letterSpacing: "0.05em", fontSize: "0.7rem" },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: "none" } } },
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        // Brand gradient (matches the login page Epic-integration button) for primary CTAs.
        // MUI v9 splits the old `containedPrimary` class into separate `contained` +
        // `colorPrimary` classes, so target both. (The `containedPrimary` styleOverrides
        // slot key is also gone in v9 — that's why this lives under `root`.)
        root: {
          textTransform: "none",
          borderRadius: 6,
          "&.MuiButton-contained.MuiButton-colorPrimary": {
            background: BRAND_GRADIENT,
            boxShadow: "0 4px 12px rgba(13,17,23,0.3)",
            "&:hover": {
              background: BRAND_GRADIENT,
              filter: "brightness(1.15)",
              boxShadow: "0 6px 16px rgba(13,17,23,0.35)",
            },
          },
        },
      },
    },
    MuiOutlinedInput: {
      styleOverrides: {
        root: {
          borderRadius: 6,
          backgroundColor: "#ffffff",
          "& .MuiOutlinedInput-notchedOutline": { borderColor: "#cbd5e1" },
          "&:hover .MuiOutlinedInput-notchedOutline": { borderColor: "#94a3b8" },
          "&.Mui-focused .MuiOutlinedInput-notchedOutline": { borderWidth: 2 },
        },
      },
    },
    MuiAppBar: {
      defaultProps: { elevation: 0, color: "inherit" },
      styleOverrides: { root: { borderBottom: "1px solid #e2e8f0", backgroundColor: "#ffffff" } },
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          backgroundColor: "#f1f5f9",
          color: "#64748b",
          fontWeight: 600,
          fontSize: "0.72rem",
          letterSpacing: "0.05em",
          textTransform: "uppercase",
        },
        root: { borderColor: "#e2e8f0", paddingTop: 12, paddingBottom: 12 },
      },
    },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
  },
});
