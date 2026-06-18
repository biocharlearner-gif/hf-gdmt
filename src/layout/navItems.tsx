import type { ReactNode } from "react";
import PeopleAltIcon from "@mui/icons-material/PeopleAltOutlined";
import CalendarMonthIcon from "@mui/icons-material/CalendarMonthOutlined";
import BarChartIcon from "@mui/icons-material/BarChartOutlined";
import SettingsIcon from "@mui/icons-material/SettingsOutlined";

export interface NavItem {
  label: string;
  to: string;
  icon: ReactNode;
  /** Not yet implemented — rendered disabled as a roadmap placeholder. */
  disabled?: boolean;
}

/**
 * Single source of truth for the left-nav menu. Add a screen here and it shows
 * up in the sidebar — keep this list in sync with the routes in App.tsx.
 */
export const NAV_ITEMS: NavItem[] = [
  { label: "Patients", to: "/patients", icon: <PeopleAltIcon /> },
  { label: "Appointments", to: "/appointments", icon: <CalendarMonthIcon />, disabled: true },
  { label: "Analytics", to: "/analytics", icon: <BarChartIcon />, disabled: true },
  { label: "Settings", to: "/settings", icon: <SettingsIcon />, disabled: true },
];
