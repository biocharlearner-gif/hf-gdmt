import { useCallback, useEffect, useState } from "react";
import { Outlet, useLocation, useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  Snackbar,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import {
  fullName,
  mrnOf,
  formatDobLong,
  ageFromIso,
  initialsOf,
  avatarColors,
  type FhirPatient,
} from "./patientMapper";
import { getPatient, deletePatient } from "./patientApi";
import PatientFormDialog from "./PatientFormDialog";
import ConfirmDialog from "./ConfirmDialog";

/** Context handed to the patient sub-pages (Demographics / Vitals) via <Outlet/>. */
export interface PatientOutletContext {
  patient: FhirPatient;
  onEdit: () => void;
}

/** Tab definitions: label + the route segment under /patients/:id (null = disabled). */
const TABS: { label: string; segment: string | null }[] = [
  { label: "Overview", segment: null },
  { label: "Demographics", segment: "demographics" },
  { label: "Vitals", segment: "vitals" },
  { label: "Tasks", segment: "tasks" },
];

/**
 * Patient view shell: loads the patient, renders the full-width app bar + tabs, and
 * hosts the active sub-page (Demographics / Vitals) via <Outlet/>. Each tab is now a
 * real route (/patients/:id/demographics|vitals) so sub-pages are linkable.
 */
export default function PatientViewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { pathname } = useLocation();

  const [patient, setPatient] = useState<FhirPatient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getPatient(id)
      .then(setPatient)
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load patient"))
      .finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    // Data-fetching effect; the synchronous loading reset is the documented exception.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const onDelete = async () => {
    setDeleting(true);
    try {
      await deletePatient(id);
      navigate("/patients", { replace: true });
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Delete failed");
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", py: 8 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !patient) {
    return (
      <Box>
        <Button startIcon={<ArrowBackIcon />} onClick={() => navigate("/patients")} sx={{ mb: 2 }}>
          Back to list
        </Button>
        <Alert severity="error">{error ?? "Patient not found."}</Alert>
      </Box>
    );
  }

  const age = ageFromIso(patient.birthDate);
  const c = avatarColors(patient);

  // Active tab follows the URL; default to Demographics when on the bare patient route.
  const seg = pathname.endsWith("/vitals") ? "vitals" : pathname.endsWith("/tasks") ? "tasks" : "demographics";
  const activeTab = TABS.findIndex((t) => t.segment === seg);

  return (
    <Box>
      {/* Full-width app bar: identity on the left, actions on the right */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          px: 3,
          py: 1.75,
          bgcolor: "background.paper",
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <IconButton onClick={() => navigate("/patients")} aria-label="Back to patients list">
          <ArrowBackIcon />
        </IconButton>
        <Avatar sx={{ bgcolor: c.bg, color: c.fg, width: 48, height: 48, fontWeight: 700 }}>
          {initialsOf(patient)}
        </Avatar>
        <Box sx={{ flexGrow: 1, minWidth: 0 }}>
          <Typography variant="h5" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
            {fullName(patient)}
          </Typography>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, color: "text.secondary", flexWrap: "wrap" }}>
            {age !== null && <Chip size="small" label={`Age: ${age}`} sx={{ bgcolor: "#f1f5f9" }} />}
            <Typography variant="body2">DOB: {formatDobLong(patient.birthDate)}</Typography>
            <Typography variant="body2" sx={{ textTransform: "capitalize" }}>
              · Gender: {patient.gender ?? "—"}
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: "flex", gap: 1 }}>
          <Button color="error" variant="outlined" startIcon={<DeleteOutlineIcon />} onClick={() => setConfirmDelete(true)}>
            Delete Patient
          </Button>
          <Button variant="contained" startIcon={<EditIcon />} onClick={() => setEditing(true)}>
            Edit Patient
          </Button>
        </Box>
      </Box>

      {/* Full-width tabs → each navigates to its sub-page route */}
      <Tabs
        value={activeTab}
        onChange={(_, v) => {
          const seg = TABS[v]?.segment;
          if (seg) navigate(seg);
        }}
        sx={{ px: 3, bgcolor: "background.paper", borderBottom: "1px solid", borderColor: "divider" }}
      >
        {TABS.map((t) => (
          <Tab key={t.label} label={t.label} disabled={!t.segment} sx={{ textTransform: "none", fontWeight: 600 }} />
        ))}
      </Tabs>

      <Box sx={{ p: 3 }}>
        <Outlet context={{ patient, onEdit: () => setEditing(true) } satisfies PatientOutletContext} />
      </Box>

      <PatientFormDialog
        open={editing}
        patient={patient}
        onClose={() => setEditing(false)}
        onSaved={(msg) => {
          setToast(msg);
          load();
        }}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete patient?"
        message={`Are you sure you want to delete ${fullName(patient)} (MRN ${mrnOf(patient)})? This cannot be undone.`}
        busy={deleting}
        onConfirm={onDelete}
        onCancel={() => setConfirmDelete(false)}
      />

      <Snackbar
        open={Boolean(toast)}
        autoHideDuration={3000}
        onClose={() => setToast(null)}
        message={toast ?? ""}
        anchorOrigin={{ vertical: "bottom", horizontal: "center" }}
      />
    </Box>
  );
}
