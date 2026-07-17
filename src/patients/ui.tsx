import type { ReactNode } from "react";
import { Box, CircularProgress, Paper, Typography } from "@mui/material";

/**
 * Small presentational primitives shared across the patient tabs. These started out
 * local to DemographicsPage; they moved here once the Clinical tab needed the same
 * card chrome and spinner.
 */

/** White card with a titled header (bottom border) + optional header action. */
export function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <Paper variant="outlined" sx={{ borderRadius: 2 }}>
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          px: 2.5,
          py: 1.75,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography variant="h6" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
        {action}
      </Box>
      <Box sx={{ p: 2.5 }}>{children}</Box>
    </Paper>
  );
}

export function Loading() {
  return (
    <Box sx={{ display: "flex", justifyContent: "center", py: 2 }}>
      <CircularProgress size={22} />
    </Box>
  );
}

/** Muted placeholder for a list/section with nothing to show. */
export function EmptyState({ children }: { children: ReactNode }) {
  return (
    <Typography variant="body2" color="text.secondary">
      {children}
    </Typography>
  );
}
