import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Alert, Avatar, Box, Button, CircularProgress, Container, Divider,
  InputAdornment, Paper, TextField, Typography,
} from "@mui/material";
import PersonSearchIcon from "@mui/icons-material/PersonSearch";
import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import LogoutIcon from "@mui/icons-material/Logout";
import { getSession, getClient, setSelectedPatient } from "../session";

interface Hit { id: string; name: string; birthDate?: string; gender?: string }

function humanName(p: any): string {
  const n = p?.name?.[0];
  if (!n) return "Unknown";
  if (n.text) return n.text;
  return [(n.given ?? []).join(" "), n.family].filter(Boolean).join(" ") || "Unknown";
}

function initialsOf(name: string): string {
  return name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();
}

export default function PatientSelect() {
  const navigate = useNavigate();
  const [family, setFamily] = useState("");
  const [given, setGiven] = useState("");
  const [byId, setById] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchUnavailable, setSearchUnavailable] = useState(false);

  useEffect(() => {
    if (!getSession()) navigate("/", { replace: true });
  }, [navigate]);

  function open(id: string) {
    if (!id.trim()) return;
    setSelectedPatient(id.trim());
    navigate("/patient");
  }

  async function search(e: React.FormEvent) {
    e.preventDefault();
    if (!family.trim() && !given.trim()) {
      setError("Enter at least a family or given name.");
      return;
    }
    setBusy(true); setError(null); setSearchUnavailable(false); setHits(null);
    try {
      const params: Record<string, string> = {};
      if (family.trim()) params.family = family.trim();
      if (given.trim()) params.given = given.trim();
      const bundle = await getClient().search("Patient", params);
      const found: Hit[] = (bundle.entry ?? [])
        .map((en: any) => en.resource)
        .filter((r: any) => r?.resourceType === "Patient")
        .map((p: any) => ({ id: p.id, name: humanName(p), birthDate: p.birthDate, gender: p.gender }));
      setHits(found);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Search failed";
      // Epic gates Patient.Search separately from Patient.Read → a 403 here means the
      // Search API isn't enabled on the app. Open-by-id still works (Patient.Read).
      if (/->\s*403/.test(msg) || msg.includes("403")) {
        setSearchUnavailable(true);
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  const rowSx = { display: "flex", gap: 1.5 } as const;

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default", display: "flex", alignItems: "center", py: 6 }}>
      <Container maxWidth="sm">
        <Paper variant="outlined" sx={{ borderRadius: 3, p: { xs: 3, sm: 4 }, boxShadow: "0 1px 3px rgba(16,24,40,0.06)" }}>
          {/* Header */}
          <Box sx={{ ...rowSx, alignItems: "center", mb: 0.5 }}>
            <Avatar variant="rounded" sx={{ bgcolor: "primary.main", width: 40, height: 40 }}>
              <PersonSearchIcon fontSize="small" />
            </Avatar>
            <Box>
              <Typography variant="overline" color="primary.main" sx={{ display: "block", lineHeight: 1.4 }}>
                Provider · Select patient
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>Find a patient</Typography>
            </Box>
          </Box>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1, mb: 3 }}>
            Search the Epic sandbox by name, or open a known patient by FHIR id.
          </Typography>

          {/* Name search */}
          <Box component="form" onSubmit={search}>
            <Box sx={{ display: "flex", flexDirection: { xs: "column", sm: "row" }, gap: 1.5 }}>
              <TextField
                fullWidth size="small" label="Family name" value={family}
                onChange={(e) => setFamily(e.target.value)}
              />
              <TextField
                fullWidth size="small" label="Given name (optional)" value={given}
                onChange={(e) => setGiven(e.target.value)}
              />
            </Box>
            <Button
              type="submit" fullWidth variant="contained" disabled={busy}
              startIcon={busy ? <CircularProgress size={16} color="inherit" /> : <PersonSearchIcon />}
              sx={{ mt: 1.5, py: 1 }}
            >
              {busy ? "Searching…" : "Search"}
            </Button>
          </Box>

          {error && <Alert severity="error" sx={{ mt: 2 }}>{error}</Alert>}
          {searchUnavailable && (
            <Alert severity="info" sx={{ mt: 2 }}>
              Name search isn’t enabled on this Epic app (needs the <strong>Patient.Search</strong> API).
              Open a patient by <strong>FHIR id</strong> below.
            </Alert>
          )}

          {/* Results */}
          {hits && (
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1, mt: 2 }}>
              {hits.length === 0 && (
                <Typography variant="body2" color="text.secondary">No patients found.</Typography>
              )}
              {hits.map((h) => (
                <Paper
                  key={h.id} variant="outlined"
                  onClick={() => open(h.id)}
                  sx={{
                    p: 1.5, borderRadius: 2, display: "flex", alignItems: "center", gap: 1.5, cursor: "pointer",
                    "&:hover": { borderColor: "primary.main", bgcolor: "action.hover" },
                  }}
                >
                  <Avatar sx={{ width: 34, height: 34, bgcolor: "primary.light", fontSize: 13, fontWeight: 700 }}>
                    {initialsOf(h.name)}
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>{h.name}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {h.gender ?? "?"} · {h.birthDate ?? "?"}
                    </Typography>
                  </Box>
                </Paper>
              ))}
            </Box>
          )}

          <Divider sx={{ my: 3 }}>or</Divider>

          {/* Open by FHIR id */}
          <Box sx={rowSx}>
            <TextField
              fullWidth size="small" placeholder="Paste a Patient FHIR id" value={byId}
              onChange={(e) => setById(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") open(byId); }}
              slotProps={{
                input: {
                  startAdornment: (
                    <InputAdornment position="start"><BadgeOutlinedIcon fontSize="small" color="action" /></InputAdornment>
                  ),
                },
              }}
            />
            <Button variant="outlined" disabled={!byId.trim()} onClick={() => open(byId)} sx={{ flexShrink: 0 }}>
              Open by id
            </Button>
          </Box>

          <Divider sx={{ my: 3 }} />
          <Button fullWidth color="inherit" startIcon={<LogoutIcon />} onClick={() => navigate("/")}>
            Disconnect
          </Button>
        </Paper>
      </Container>
    </Box>
  );
}
