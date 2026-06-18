import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";
import {
  AppBar,
  Avatar,
  Box,
  Button,
  Divider,
  Drawer,
  IconButton,
  InputAdornment,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  TextField,
  Toolbar,
  Tooltip,
  Typography,
} from "@mui/material";
import MenuIcon from "@mui/icons-material/Menu";
import SearchIcon from "@mui/icons-material/Search";
import NotificationsNoneIcon from "@mui/icons-material/NotificationsNone";
import HelpOutlineIcon from "@mui/icons-material/HelpOutlineOutlined";
import AddIcon from "@mui/icons-material/Add";
import LogoutIcon from "@mui/icons-material/Logout";
import SupportAgentIcon from "@mui/icons-material/SupportAgent";
import { NAV_ITEMS } from "./navItems";

const DRAWER_WIDTH = 256;

/**
 * Persistent app shell: fixed left navigation drawer + top bar, with the active
 * screen rendered on the right via <Outlet/>. New screens are added by listing
 * them in navItems.tsx and adding a nested route under this layout in App.tsx.
 */
export default function AppLayout() {
  const location = useLocation();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);

  const drawer = (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", bgcolor: "background.paper" }}>
      <Box sx={{ px: 3, py: 2.5 }}>
        <Typography variant="h6" color="primary" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
          MediFlow Pro
        </Typography>
        <Typography variant="caption" color="text.secondary">
          General Hospital Central
        </Typography>
      </Box>

      <List sx={{ px: 1.5, flexGrow: 1 }}>
        {NAV_ITEMS.map((item) => {
          const active = location.pathname.startsWith(item.to);
          const button = (
            <ListItemButton
              key={item.label}
              component={item.disabled ? "div" : Link}
              to={item.disabled ? undefined : item.to}
              selected={!item.disabled && active}
              disabled={item.disabled}
              onClick={() => setMobileOpen(false)}
              sx={{
                borderRadius: 1.5,
                mb: 0.5,
                py: 1,
                color: "text.secondary",
                "&.Mui-selected": {
                  bgcolor: "rgba(0,94,184,0.08)",
                  color: "primary.main",
                  fontWeight: 600,
                },
                "&.Mui-selected:hover": { bgcolor: "rgba(0,94,184,0.12)" },
                "&.Mui-selected .MuiListItemIcon-root": { color: "primary.main" },
              }}
            >
              <ListItemIcon sx={{ minWidth: 38, color: "inherit" }}>{item.icon}</ListItemIcon>
              <ListItemText
                primary={item.label}
                sx={{ "& .MuiListItemText-primary": { fontWeight: active ? 600 : 500 } }}
              />
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

      <Box sx={{ p: 2 }}>
        <Button
          fullWidth
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => navigate("/patients?new=1")}
          sx={{ py: 1.1, mb: 1 }}
        >
          New Record
        </Button>
        <Divider sx={{ my: 1 }} />
        <List dense disablePadding>
          <Tooltip title="Coming soon" placement="right">
            <span>
              <ListItemButton disabled sx={{ borderRadius: 1.5, color: "text.secondary" }}>
                <ListItemIcon sx={{ minWidth: 38, color: "inherit" }}>
                  <SupportAgentIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Help Center" />
              </ListItemButton>
            </span>
          </Tooltip>
          <Tooltip title="Coming soon" placement="right">
            <span>
              <ListItemButton disabled sx={{ borderRadius: 1.5, color: "text.secondary" }}>
                <ListItemIcon sx={{ minWidth: 38, color: "inherit" }}>
                  <LogoutIcon fontSize="small" />
                </ListItemIcon>
                <ListItemText primary="Sign Out" />
              </ListItemButton>
            </span>
          </Tooltip>
        </List>
      </Box>
    </Box>
  );

  return (
    <Box sx={{ display: "flex", minHeight: "100vh", bgcolor: "background.default" }}>
      <AppBar
        position="fixed"
        sx={{ width: { md: `calc(100% - ${DRAWER_WIDTH}px)` }, ml: { md: `${DRAWER_WIDTH}px` } }}
      >
        <Toolbar sx={{ gap: 2 }}>
          <IconButton edge="start" onClick={() => setMobileOpen((o) => !o)} sx={{ display: { md: "none" } }}>
            <MenuIcon />
          </IconButton>
          <TextField
            size="small"
            placeholder="Search patients or records…"
            sx={{ maxWidth: 520, flexGrow: 1, "& .MuiOutlinedInput-root": { bgcolor: "#f1f5f9" } }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" sx={{ color: "text.secondary" }} />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Box sx={{ flexGrow: 1 }} />
          <IconButton size="small">
            <NotificationsNoneIcon />
          </IconButton>
          <IconButton size="small">
            <HelpOutlineIcon />
          </IconButton>
          <Box sx={{ display: { xs: "none", sm: "block" }, textAlign: "right", lineHeight: 1.1 }}>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Dr. Smith
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ letterSpacing: "0.05em" }}>
              CHIEF SURGEON
            </Typography>
          </Box>
          <Avatar sx={{ bgcolor: "primary.main", width: 38, height: 38 }}>DS</Avatar>
        </Toolbar>
      </AppBar>

      <Box component="nav" sx={{ width: { md: DRAWER_WIDTH }, flexShrink: { md: 0 } }}>
        <Drawer
          variant="temporary"
          open={mobileOpen}
          onClose={() => setMobileOpen(false)}
          ModalProps={{ keepMounted: true }}
          sx={{
            display: { xs: "block", md: "none" },
            "& .MuiDrawer-paper": { width: DRAWER_WIDTH, boxSizing: "border-box" },
          }}
        >
          {drawer}
        </Drawer>
        <Drawer
          variant="permanent"
          open
          sx={{
            display: { xs: "none", md: "block" },
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

      <Box component="main" sx={{ flexGrow: 1, width: { md: `calc(100% - ${DRAWER_WIDTH}px)` } }}>
        <Toolbar /> {/* spacer for the fixed AppBar */}
        <Box sx={{ p: { xs: 2, md: 4 } }}>
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
}
