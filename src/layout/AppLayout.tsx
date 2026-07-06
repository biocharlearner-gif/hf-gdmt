import { Link, Outlet, useLocation } from "react-router-dom";
import {
  Avatar,
  Box,
  Divider,
  Drawer,
  IconButton,
  List,
  ListItemButton,
  Tooltip,
  Typography,
} from "@mui/material";
import LogoutIcon from "@mui/icons-material/Logout";
import FavoriteIcon from "@mui/icons-material/Favorite";
import { NAV_ITEMS } from "./navItems";
import { BRAND_GRADIENT } from "../brand";

const DRAWER_WIDTH = 96;

/**
 * Persistent desktop app shell: compact left navigation rail with the active
 * screen rendered on the right via <Outlet/>. New screens are added by listing
 * them in navItems.tsx and adding a nested route under this layout.
 */
export default function AppLayout() {
  const location = useLocation();

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", bgcolor: "background.paper" }}>
      {/* Brand mark */}
      <Box sx={{ px: 1.5, py: 2.5, display: "flex", flexDirection: "column", alignItems: "center", gap: 1 }}>
        <Box
          sx={{
            width: 40,
            height: 40,
            borderRadius: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#fff",
            background: BRAND_GRADIENT,
            boxShadow: "0 4px 12px rgba(13,17,23,0.35)",
            marginBottom: 1, // optical alignment
          }}
        >
          <FavoriteIcon sx={{ fontSize: 20 }} />
        </Box>
        <Box sx={{ textAlign: "center", lineHeight: 1, fontFamily: '"Sora", "Inter", sans-serif' }}>
          <Typography
            sx={{
              fontFamily: "inherit",
              fontWeight: 800,
              fontSize: "0.8rem",
              color: "text.secondary",
              letterSpacing: "0.18em",
              textTransform: "uppercase",
            }}
          >
            HF&nbsp;GDMT
          </Typography>
          <Typography
            sx={{
              fontFamily: "inherit",
              fontWeight: 800,
              fontSize: "0.9rem",
              letterSpacing: "-0.01em",
              background: BRAND_GRADIENT,
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
            }}
          >
            Optimizer
          </Typography>
        </Box>
      </Box>

      <List disablePadding sx={{ flexGrow: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.to);
          const button = (
            <ListItemButton
              key={item.label}
              component={item.disabled ? "div" : Link}
              to={item.disabled ? undefined : item.to}
              selected={!item.disabled && active}
              disabled={item.disabled}
              sx={{
                flexDirection: "column",
                gap: 0.5,
                borderRadius: 0,
                py: 1.25,
                color: "text.secondary",
                textAlign: "center",
                "&.Mui-selected": {
                  background: BRAND_GRADIENT,
                  color: "#fff",
                  boxShadow: "0 4px 12px rgba(13,17,23,0.3)",
                },
                "&.Mui-selected:hover": {
                  background: BRAND_GRADIENT,
                  filter: "brightness(1.15)",
                },
              }}
            >
              <Box sx={{ display: "flex", color: "inherit" }}>{item.icon}</Box>
              <Typography sx={{ fontSize: "0.8rem", fontWeight: active ? 700 : 500, color: "inherit" }}>
                {item.label}
              </Typography>
            </ListItemButton>
          );
          return item.disabled ? (
            <Tooltip key={item.label} title="Coming soon" placement="right">
              <span>{button}</span>
            </Tooltip>
          ) : (
            button
          );
        })}
      </List>

      {/* Bottom: signed-in user */}
      <Box sx={{ p: 1.5, display: "flex", flexDirection: "column", alignItems: "center", gap: 1.5 }}>
        <Divider flexItem />

        <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 0.5, textAlign: "center" }}>
          <Avatar sx={{ bgcolor: "primary.main", width: 36, height: 36, fontSize: 14 }}>DS</Avatar>
          <Box sx={{ lineHeight: 1.1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600, fontSize: "0.78rem" }}>
              Dr. Smith
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.6rem", letterSpacing: "0.05em" }}>
              CHIEF SURGEON
            </Typography>
          </Box>
          <Tooltip title="Sign out (coming soon)" placement="right">
            <span>
              <IconButton size="small" disabled sx={{ color: "text.secondary" }}>
                <LogoutIcon fontSize="small" />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <Box component="nav" sx={{ width: DRAWER_WIDTH, flexShrink: 0 }}>
        <Drawer
          variant="permanent"
          open
          sx={{
            "& .MuiDrawer-paper": {
              width: DRAWER_WIDTH,
              boxSizing: "border-box",
              borderRight: "1px solid",
              borderColor: "divider",
            },
          }}
        >
          {drawer}
        </Drawer>
      </Box>

      <Box component="main" sx={{ flexGrow: 1, width: `calc(100% - ${DRAWER_WIDTH}px)` }}>
        <Outlet />
      </Box>
    </Box>
  );
}
