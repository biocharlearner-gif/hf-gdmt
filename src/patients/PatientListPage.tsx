import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  CircularProgress,
  IconButton,
  MenuItem,
  Paper,
  Snackbar,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import TuneIcon from "@mui/icons-material/Tune";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import { usePatients } from "./usePatients";
import {
  fullName,
  mrnOf,
  formatDobLong,
  initialsOf,
  avatarColors,
  type FhirPatient,
} from "./patientMapper";
import { deletePatient } from "./patientApi";
import PatientFormDialog from "./PatientFormDialog";
import ConfirmDialog from "./ConfirmDialog";

const PAGE_SIZES = [10, 25, 50];

export default function PatientListPage() {
  const {
    filters,
    setFilters,
    page,
    setPage,
    pageSize,
    setPageSize,
    patients,
    total,
    pageCount,
    loading,
    error,
    refetch,
  } = usePatients();

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  const [toDelete, setToDelete] = useState<FhirPatient | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Open the Add dialog when arriving via the sidebar "New Record" action.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormOpen(true);
      searchParams.delete("new");
      setSearchParams(searchParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  const confirmDelete = async () => {
    if (!toDelete?.id) return;
    setDeleting(true);
    try {
      await deletePatient(toDelete.id);
      setToast("Patient deleted");
      setToDelete(null);
      refetch();
    } catch (e) {
      setToast(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeleting(false);
    }
  };

  const from = total === 0 ? 0 : page * pageSize + 1;
  const to = Math.min((page + 1) * pageSize, total);

  return (
    <Box sx={{ maxWidth: 1200, mx: "auto" }}>
      <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", mb: 3 }}>
        <Box>
          <Typography variant="h4">Patients</Typography>
          <Typography variant="body2" color="text.secondary">
            Manage and monitor your current patient database.
          </Typography>
        </Box>
        <Button variant="contained" startIcon={<SearchIcon />} onClick={() => setFormOpen(true)}>
          Add Patient
        </Button>
      </Box>

      {/* Search bar */}
      <Paper variant="outlined" sx={{ p: 2, mb: 3, borderRadius: 2 }}>
        <Box
          sx={{
            display: "grid",
            gap: 2,
            alignItems: "end",
            gridTemplateColumns: { xs: "1fr", md: "1fr 1fr 1fr auto auto" },
          }}
        >
          <Labeled label="Full Name">
            <TextField
              size="small"
              fullWidth
              placeholder="e.g. John Doe"
              value={filters.name}
              onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))}
            />
          </Labeled>
          <Labeled label="Date of Birth">
            <TextField
              size="small"
              fullWidth
              type="date"
              value={filters.birthDate}
              onChange={(e) => setFilters((f) => ({ ...f, birthDate: e.target.value }))}
            />
          </Labeled>
          <Labeled label="MRN">
            <TextField
              size="small"
              fullWidth
              placeholder="Medical Record #"
              value={filters.mrn}
              onChange={(e) => setFilters((f) => ({ ...f, mrn: e.target.value }))}
            />
          </Labeled>
          <Button variant="contained" startIcon={<SearchIcon />} onClick={refetch} sx={{ height: 40 }}>
            Search
          </Button>
          <Tooltip title="More filters (coming soon)">
            <span>
              <IconButton sx={{ border: "1px solid", borderColor: "divider", borderRadius: 1.5, height: 40, width: 40 }}>
                <TuneIcon />
              </IconButton>
            </span>
          </Tooltip>
        </Box>
      </Paper>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Patient table */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Full Name</TableCell>
                <TableCell>Gender</TableCell>
                <TableCell>Date of Birth</TableCell>
                <TableCell>Medical Record Number</TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : patients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} align="center" sx={{ py: 6, color: "text.secondary" }}>
                    No patients found.
                  </TableCell>
                </TableRow>
              ) : (
                patients.map((p) => {
                  const c = avatarColors(p);
                  return (
                    <TableRow
                      key={p.id}
                      hover
                      sx={{ cursor: "pointer", "&:hover": { bgcolor: "rgba(0,94,184,0.04)" } }}
                      onClick={() => navigate(`/patients/${p.id}`)}
                    >
                      <TableCell>
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                          <Avatar sx={{ bgcolor: c.bg, color: c.fg, width: 36, height: 36, fontSize: 14, fontWeight: 600 }}>
                            {initialsOf(p)}
                          </Avatar>
                          <Typography variant="body2" sx={{ fontWeight: 600 }}>
                            {fullName(p)}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={{ textTransform: "capitalize", color: "text.secondary" }}>
                        {p.gender ?? "—"}
                      </TableCell>
                      <TableCell sx={{ color: "text.secondary" }}>{formatDobLong(p.birthDate)}</TableCell>
                      <TableCell sx={{ color: "text.secondary" }}>
                        {mrnOf(p) ? `#${mrnOf(p)}` : "—"}
                      </TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <Tooltip title="View">
                          <IconButton size="small" onClick={() => navigate(`/patients/${p.id}`)}>
                            <VisibilityOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Delete">
                          <IconButton size="small" color="error" onClick={() => setToDelete(p)}>
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>
        </TableContainer>

        {/* Footer / pagination */}
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", md: "row" },
            justifyContent: "space-between",
            alignItems: "center",
            gap: 2,
            px: 2,
            py: 1.5,
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Showing {from}–{to} of {total}
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
              Show
            </Typography>
            <TextField
              select
              size="small"
              value={pageSize}
              onChange={(e) => setPageSize(Number(e.target.value))}
              sx={{ width: 76 }}
            >
              {PAGE_SIZES.map((n) => (
                <MenuItem key={n} value={n}>
                  {n}
                </MenuItem>
              ))}
            </TextField>
            <Typography variant="body2" color="text.secondary">
              per page
            </Typography>
          </Box>

          <Box sx={{ display: "flex", gap: 1, alignItems: "center" }}>
            <Typography variant="body2" color="text.secondary">
              Page {page + 1} of {pageCount}
            </Typography>
            <Button variant="outlined" color="inherit" size="small" disabled={page === 0} onClick={() => setPage(page - 1)}>
              Previous
            </Button>
            <Button
              variant="outlined"
              color="inherit"
              size="small"
              disabled={page >= pageCount - 1}
              onClick={() => setPage(page + 1)}
            >
              Next
            </Button>
          </Box>
        </Box>
      </Paper>

      {/* Secondary info cards */}
      <Box sx={{ display: "grid", gap: 3, mt: 3, gridTemplateColumns: { xs: "1fr", md: "1fr 2fr" } }}>
        <Paper sx={{ p: 3, borderRadius: 2, bgcolor: "primary.dark", color: "primary.contrastText" }}>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>
            Patient Intake
          </Typography>
          <Typography variant="body2" sx={{ opacity: 0.85, mt: 1, mb: 2 }}>
            You have 4 new patient records pending verification and archival.
          </Typography>
          <Button variant="contained" sx={{ bgcolor: "#fff", color: "primary.dark", "&:hover": { bgcolor: "#e2e8f0" } }}>
            Review Now
          </Button>
        </Paper>
        <Paper variant="outlined" sx={{ p: 3, borderRadius: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, mb: 2 }}>
            Hospital Statistics
          </Typography>
          <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr 1fr", sm: "repeat(4, 1fr)" }, gap: 2 }}>
            <Stat label="Total Patients" value={total ? total.toLocaleString() : "—"} color="primary.main" />
            <Stat label="Active Beds" value="84%" color="success.main" />
            <Stat label="Emergency" value="12" color="error.main" />
            <Stat label="Discharged" value="32" color="text.primary" />
          </Box>
        </Paper>
      </Box>

      <PatientFormDialog
        open={formOpen}
        onClose={() => setFormOpen(false)}
        onSaved={(msg) => {
          setToast(msg);
          refetch();
        }}
      />

      <ConfirmDialog
        open={Boolean(toDelete)}
        title="Delete patient?"
        message={
          toDelete
            ? `Are you sure you want to delete ${fullName(toDelete)} (MRN ${mrnOf(toDelete)})? This cannot be undone.`
            : ""
        }
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setToDelete(null)}
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

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: "block", mb: 0.5 }}>
        {label}
      </Typography>
      {children}
    </Box>
  );
}

function Stat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <Box>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, color }}>
        {value}
      </Typography>
    </Box>
  );
}
