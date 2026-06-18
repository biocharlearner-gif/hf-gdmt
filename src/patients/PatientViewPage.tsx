import { useCallback, useEffect, useState, type ReactNode } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Snackbar,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import PhoneIcon from "@mui/icons-material/PhoneOutlined";
import EmailIcon from "@mui/icons-material/EmailOutlined";
import MapIcon from "@mui/icons-material/MapOutlined";
import WarningAmberIcon from "@mui/icons-material/WarningAmber";
import {
  fullName,
  mrnOf,
  formatDob,
  formatDobLong,
  ageFromIso,
  initialsOf,
  avatarColors,
  type FhirPatient,
} from "./patientMapper";
import { getPatient, deletePatient } from "./patientApi";
import PatientFormDialog from "./PatientFormDialog";
import ConfirmDialog from "./ConfirmDialog";

/** White card with a titled header (bottom border) + optional header action. */
function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
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

function Field({ label, value, full }: { label: string; value?: string; full?: boolean }) {
  return (
    <Box sx={{ gridColumn: full ? { sm: "1 / -1" } : undefined }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 500 }}>
        {value || "—"}
      </Typography>
    </Box>
  );
}

const TABS = ["Overview", "Demographics", "Care Plan", "Vitals"];

export default function PatientViewPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();

  const [patient, setPatient] = useState<FhirPatient | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState(1); // Demographics
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

  const addr = patient.address?.[0];
  const phone = patient.telecom?.find((t) => t.system === "phone")?.value;
  const email = patient.telecom?.find((t) => t.system === "email")?.value;
  const given = patient.name?.[0]?.given ?? [];
  const age = ageFromIso(patient.birthDate);
  const c = avatarColors(patient);

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Button startIcon={<ArrowBackIcon />} color="inherit" onClick={() => navigate("/patients")} sx={{ mb: 2 }}>
        Back to list
      </Button>

      {/* Header */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 2, flexWrap: "wrap", mb: 1 }}>
        <Avatar sx={{ bgcolor: c.bg, color: c.fg, width: 56, height: 56, fontWeight: 700 }}>
          {initialsOf(patient)}
        </Avatar>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="h4">{fullName(patient)}</Typography>
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

      {/* Tabs */}
      <Tabs value={tab} onChange={(_, v) => setTab(v)} sx={{ mb: 3, borderBottom: "1px solid", borderColor: "divider" }}>
        {TABS.map((t, i) => (
          <Tab key={t} label={t} disabled={i !== 1} sx={{ textTransform: "none", fontWeight: 600 }} />
        ))}
      </Tabs>

      {/* Two-column content */}
      <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: { xs: "1fr", md: "2fr 1fr" }, alignItems: "start" }}>
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Card
            title="Basic Info"
            action={
              <IconButton size="small" color="primary" onClick={() => setEditing(true)}>
                <EditIcon fontSize="small" />
              </IconButton>
            }
          >
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" }, gap: 2.5 }}>
              <Field label="First Name" value={given[0]} />
              <Field label="Middle Name" value={given.slice(1).join(" ")} />
              <Field label="Last Name" value={patient.name?.[0]?.family} />
              <Box>
                <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                  Gender
                </Typography>
                <Chip
                  size="small"
                  label={patient.gender ?? "unknown"}
                  sx={{ bgcolor: "#cffafe", color: "#0e7490", textTransform: "capitalize" }}
                />
              </Box>
              <Field label="DOB" value={formatDob(patient)} />
              <Field label="MRN" value={mrnOf(patient)} />
            </Box>
          </Card>

          <Card
            title="Address"
            action={<MapIcon fontSize="small" color="primary" />}
          >
            <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "1fr 1fr" }, gap: 2.5 }}>
              <Field label="Address Line" value={addr?.line?.[0]} full />
              <Field label="City" value={addr?.city} />
              <Field label="State / Province" value={addr?.state} />
              <Field label="Zip / Postal Code" value={addr?.postalCode} />
              <Field label="Country" value={addr?.country} />
            </Box>
          </Card>
        </Box>

        {/* Sidebar */}
        <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
          <Card title="Contact Info">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
                <PhoneIcon fontSize="small" color="primary" sx={{ mt: 0.3 }} />
                <Box>
                  <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                    Phone
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 500 }}>
                    {phone || "—"}
                  </Typography>
                </Box>
              </Box>
              <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-start" }}>
                <EmailIcon fontSize="small" color="primary" sx={{ mt: 0.3 }} />
                <Box sx={{ minWidth: 0 }}>
                  <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                    Email
                  </Typography>
                  <Typography variant="body1" sx={{ fontWeight: 500, wordBreak: "break-all" }}>
                    {email || "—"}
                  </Typography>
                </Box>
              </Box>
            </Box>
          </Card>

          <Card title="Patient Status">
            <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
              <Row label="Insurance Status" value={<Chip size="small" label="Verified" color="success" sx={{ bgcolor: "#cce8e3", color: "#0d9488" }} />} />
              <Divider />
              <Row label="Last Checkup" value={<Typography variant="body2" sx={{ fontWeight: 600 }}>—</Typography>} />
              <Divider />
              <Row label="Consent Form" value={<Typography variant="body2" color="primary" sx={{ fontWeight: 600 }}>Not on file</Typography>} />
            </Box>
          </Card>

          <Paper variant="outlined" sx={{ borderRadius: 2, p: 2.5, borderStyle: "dashed" }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
              <WarningAmberIcon fontSize="small" color="error" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Emergency Contact
              </Typography>
            </Box>
            <Typography variant="body2" color="text.secondary">
              No emergency contact on file.
            </Typography>
          </Paper>
        </Box>
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

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <Typography variant="body2" color="text.secondary">
        {label}
      </Typography>
      {value}
    </Box>
  );
}
