import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Avatar, Box, Button, Chip, CircularProgress, Container, Paper, Typography } from "@mui/material";
import FavoriteIcon from "@mui/icons-material/FavoriteBorder";
import LogoutIcon from "@mui/icons-material/Logout";
import { getSession, getProvider, ensureProviderDisplay } from "../session";
import { loadPatientData, type PatientData } from "../data/loadPatient";
import { createTaskForPillar, createLabOrder, createEchoOrder, createCarePlanFor } from "../data/writeActions";
import { getRationale, type PillarRationale } from "../patients/patientApi";
import GdmtView, { type ActionState, type RationaleMode } from "../patients/GdmtView";
import type { PillarResult } from "../engine/types";

/**
 * SMART on FHIR (Epic) patient view. Reads the in-context patient from Epic via
 * `loadPatientData` (in-browser token), runs the pure engine, and renders the SAME shared
 * `GdmtView` as the demo `GdmtTab` — so the real-EHR launch lands on the polished panel, not a
 * plain-CSS fallback. Write-backs go through the session's FhirClient (write base = Epic by
 * default, or VITE_FHIR_WRITE_BASE) — Epic is read-only for these, so writes may 403/405 and
 * the panel surfaces the error inline.
 */

const IDLE: ActionState = { status: "idle" };

export default function PatientView() {
  const navigate = useNavigate();
  const [data, setData] = useState<PatientData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providerName, setProviderName] = useState<string | null>(() => getProvider().display ?? null);

  const [actions, setActions] = useState<Record<string, ActionState>>({});
  const [taskRefs, setTaskRefs] = useState<string[]>([]);
  const [carePlan, setCarePlan] = useState<ActionState>(IDLE);

  const [rationale, setRationale] = useState<Record<string, PillarRationale>>({});
  const [rationaleMode, setRationaleMode] = useState<RationaleMode | null>(null);
  const [rationaleBusy, setRationaleBusy] = useState(false);
  const [rationaleError, setRationaleError] = useState<string | null>(null);

  useEffect(() => {
    if (!getSession()) {
      navigate("/", { replace: true });
      return;
    }
    loadPatientData()
      .then(setData)
      .catch((err) => setError(err instanceof Error ? err.message : "Unknown error"));
    // Resolve the ordering clinician's name (id_token often carries only a reference).
    ensureProviderDisplay().then((p) => p.display && setProviderName(p.display));
  }, [navigate]);

  const setAction = (key: string, s: ActionState) => setActions((prev) => ({ ...prev, [key]: s }));

  const handleCreateTask = useCallback(async (pillar: PillarResult) => {
    setAction(pillar.id, { status: "busy" });
    try {
      const id = await createTaskForPillar(pillar);
      setTaskRefs((prev) => [...prev, `Task/${id}`]);
      setAction(pillar.id, { status: "done", msg: `Task created (${id})` });
    } catch (err) {
      setAction(pillar.id, { status: "error", msg: err instanceof Error ? err.message : "Failed" });
    }
  }, []);

  const handleOrderLabs = useCallback(async (pillar: PillarResult) => {
    const key = `labs:${pillar.id}`;
    setAction(key, { status: "busy" });
    try {
      const id = await createLabOrder();
      setAction(key, { status: "done", msg: `Lab order created (${id})` });
    } catch (err) {
      setAction(key, { status: "error", msg: err instanceof Error ? err.message : "Failed" });
    }
  }, []);

  const handleOrderEcho = useCallback(async () => {
    setAction("echo", { status: "busy" });
    try {
      const id = await createEchoOrder();
      setAction("echo", { status: "done", msg: `Echo order created (${id})` });
    } catch (err) {
      setAction("echo", { status: "error", msg: err instanceof Error ? err.message : "Failed" });
    }
  }, []);

  const handleCarePlan = useCallback(async () => {
    if (!data) return;
    setCarePlan({ status: "busy" });
    try {
      const id = await createCarePlanFor(data.assessment, taskRefs);
      setCarePlan({ status: "done", msg: `CarePlan created (${id})` });
    } catch (err) {
      setCarePlan({ status: "error", msg: err instanceof Error ? err.message : "Failed" });
    }
  }, [data, taskRefs]);

  const explainGaps = useCallback(async () => {
    if (!data) return;
    setRationaleBusy(true);
    setRationaleError(null);
    try {
      const res = await getRationale(data.assessment);
      setRationale(Object.fromEntries(res.pillars.map((p) => [p.pillarId, p])));
      setRationaleMode(res.mode);
    } catch (e) {
      setRationaleError(e instanceof Error ? e.message : "Failed to generate explanations");
    } finally {
      setRationaleBusy(false);
    }
  }, [data]);

  if (error) {
    return (
      <Container maxWidth="sm" sx={{ py: 8 }}>
        <Paper variant="outlined" sx={{ p: 4, textAlign: "center", borderRadius: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 1 }}>
            Could not load patient
          </Typography>
          <Typography variant="body2" color="error.main" sx={{ mb: 2, wordBreak: "break-word" }}>
            {error}
          </Typography>
          <Button variant="outlined" onClick={() => navigate("/")}>
            ← Back
          </Button>
        </Paper>
      </Container>
    );
  }

  if (!data) {
    return (
      <Box sx={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", py: 12, gap: 2 }}>
        <CircularProgress />
        <Typography variant="body2" color="text.secondary">
          Reading Epic FHIR resources and running the rule engine…
        </Typography>
      </Box>
    );
  }

  const { patient, assessment } = data;
  const initials = patient.name.split(/\s+/).map((s) => s[0]).filter(Boolean).slice(0, 2).join("").toUpperCase();

  return (
    <Box sx={{ minHeight: "100vh", bgcolor: "background.default" }}>
      {/* Patient app bar */}
      <Paper elevation={0} square sx={{ borderBottom: "1px solid", borderColor: "divider" }}>
        <Container maxWidth="lg" sx={{ py: 2, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
          <Avatar sx={{ bgcolor: "primary.main", width: 48, height: 48, fontWeight: 700 }}>
            {initials || <FavoriteIcon />}
          </Avatar>
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, flexWrap: "wrap" }}>
              <Typography variant="h6" sx={{ fontWeight: 800 }}>
                {patient.name}
              </Typography>
              <Chip size="small" color="primary" variant="outlined" label="SMART on FHIR · Epic" sx={{ fontWeight: 700 }} />
            </Box>
            <Typography variant="body2" color="text.secondary">
              {patient.age ?? "?"} yrs · {patient.gender ?? "unknown"}
              {patient.mrn ? ` · MRN ${patient.mrn}` : ""}
            </Typography>
          </Box>
          {providerName && (
            <Chip
              size="small"
              variant="outlined"
              label={`Ordering as ${providerName}`}
              sx={{ fontWeight: 600 }}
            />
          )}
          <Button variant="outlined" color="inherit" startIcon={<LogoutIcon />} onClick={() => navigate("/")}>
            Disconnect
          </Button>
        </Container>
      </Paper>

      <Container maxWidth="lg" sx={{ py: 3 }}>
        <GdmtView
          assessment={assessment}
          rationale={rationale}
          rationaleMode={rationaleMode}
          rationaleBusy={rationaleBusy}
          rationaleError={rationaleError}
          onExplain={explainGaps}
          actions={actions}
          onCreateTask={handleCreateTask}
          onOrderLabs={handleOrderLabs}
          onOrderEcho={handleOrderEcho}
          footer={
            <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5, display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap" }}>
              <Box sx={{ flexGrow: 1, minWidth: 200 }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                  Generate a GDMT CarePlan
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Bundle these pillars into one Heart Failure GDMT Optimization CarePlan, written back to the
                  configured write server.{taskRefs.length > 0 ? ` ${taskRefs.length} Task(s) will link.` : ""}
                </Typography>
                {carePlan.status === "error" && (
                  <Typography variant="caption" color="error.main">
                    {carePlan.msg}
                  </Typography>
                )}
                {carePlan.status === "done" && carePlan.msg && (
                  <Typography variant="caption" color="success.main">
                    {carePlan.msg}
                  </Typography>
                )}
              </Box>
              <Button
                variant="contained"
                disabled={carePlan.status === "busy" || carePlan.status === "done"}
                onClick={handleCarePlan}
              >
                {carePlan.status === "busy" ? "Generating…" : carePlan.status === "done" ? "✓ CarePlan created" : "Generate GDMT CarePlan"}
              </Button>
            </Paper>
          }
        />
      </Container>
    </Box>
  );
}
