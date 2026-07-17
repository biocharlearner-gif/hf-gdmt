import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  Alert,
  Avatar,
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  Snackbar,
  ToggleButton,
  ToggleButtonGroup,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  TableSortLabel,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import SearchIcon from "@mui/icons-material/Search";
import AddIcon from "@mui/icons-material/Add";
import VisibilityOutlinedIcon from "@mui/icons-material/VisibilityOutlined";
import EditOutlinedIcon from "@mui/icons-material/EditOutlined";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutlined";
import { usePatients } from "./usePatients";
import {
  fullName,
  mrnOf,
  formatDobLong,
  ageFromIso,
  initialsOf,
  avatarColors,
  type FhirPatient,
} from "./patientMapper";
import { deletePatient } from "./patientApi";
import PatientFormDialog from "./PatientFormDialog";
import ConfirmDialog from "./ConfirmDialog";
import { RiskChip } from "./RiskChip";
import { HF_COHORT_HINT, NON_HF_COHORT_HINT } from "./problemList";

const PAGE_SIZES = [10, 25, 50];

export default function PatientListPage() {
  const {
    filters,
    setFilters,
    hfFilter,
    setHfFilter,
    page,
    setPage,
    pageSize,
    setPageSize,
    sortBy,
    setSortBy,
    patients,
    hfIds,
    riskById,
    risksLoading,
    total,
    pageCount,
    loading,
    error,
    refetch,
  } = usePatients();

  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [formOpen, setFormOpen] = useState(false);
  // Patient being edited (null = Add mode). Reuses the same PatientFormDialog.
  const [formPatient, setFormPatient] = useState<FhirPatient | null>(null);
  const [toDelete, setToDelete] = useState<FhirPatient | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Open the Add dialog when arriving via the sidebar "New Record" action.
  useEffect(() => {
    if (searchParams.get("new") === "1") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFormPatient(null);
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
    <Box>
      {/* Top app bar: spans the full main width, page title + primary action */}
      <Paper
        elevation={0}
        square
        sx={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 2,
          px: 3,
          py: 1.5,
          mb: 2,
          borderBottom: "1px solid",
          borderColor: "divider",
        }}
      >
        <Typography variant="h5" sx={{ fontWeight: 700, flexShrink: 0 }}>
          Patients
        </Typography>
        <TextField
          size="small"
          placeholder="Search by name or MRN…"
          value={filters.query}
          onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
          sx={{ maxWidth: 360, flexGrow: 1, ml: "auto" }}
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
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => {
            setFormPatient(null);
            setFormOpen(true);
          }}
          sx={{ flexShrink: 0 }}
        >
          Add Patient
        </Button>
      </Paper>

      <Box sx={{ px: 3, pb: 3 }}>
      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {/* Toolbar: page size (left) + cohort filter (right), above the table */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 2,
          mb: 2,
          flexWrap: "wrap",
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
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

        <ToggleButtonGroup
          size="small"
          exclusive
          value={hfFilter}
          onChange={(_, v) => v && setHfFilter(v)}
          sx={{
            bgcolor: "#e5e5e5",
            borderRadius: 999,
            p: 0.5,
            gap: 0.25,
            "& .MuiToggleButton-root": {
              border: 0,
              borderRadius: "999px !important",
              textTransform: "none",
              fontWeight: 600,
              fontSize: "0.8rem",
              color: "text.secondary",
              px: 1.75,
              py: 0.5,
              "&:hover": { bgcolor: "rgba(0,0,0,0.04)" },
              "&.Mui-selected": {
                bgcolor: "#fff",
                color: "text.primary",
                boxShadow: "0 1px 2px rgba(15,23,42,0.12)",
                "&:hover": { bgcolor: "#fff" },
              },
            },
          }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="hf">
            <Tooltip title={HF_COHORT_HINT}>
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center" }}>
                <Dot color="#1d6fd6" /> HF Patients
              </Box>
            </Tooltip>
          </ToggleButton>
          <ToggleButton value="non-hf">
            <Tooltip title={NON_HF_COHORT_HINT}>
              <Box component="span" sx={{ display: "inline-flex", alignItems: "center" }}>
                <Dot color="#94a3b8" /> Non-HF Patients
              </Box>
            </Tooltip>
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* Patient table */}
      <Paper variant="outlined" sx={{ borderRadius: 2, overflow: "hidden" }}>
        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>Full Name</TableCell>
                <TableCell>Gender</TableCell>
                <TableCell>Date of Birth</TableCell>
                <TableCell>Age</TableCell>
                <TableCell>MRN</TableCell>
                <TableCell>Cohort</TableCell>
                <TableCell sortDirection={sortBy === "risk" ? "desc" : false}>
                  <Tooltip title="HF congestion risk — sort sickest-first">
                    <TableSortLabel
                      active={sortBy === "risk"}
                      direction="desc"
                      hideSortIcon={false}
                      onClick={() => setSortBy(sortBy === "risk" ? "name" : "risk")}
                    >
                      Risk
                    </TableSortLabel>
                  </Tooltip>
                </TableCell>
                <TableCell align="right">Actions</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {loading ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6 }}>
                    <CircularProgress size={28} />
                  </TableCell>
                </TableRow>
              ) : patients.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} align="center" sx={{ py: 6, color: "text.secondary" }}>
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
                      sx={{ cursor: "pointer", "&:hover": { bgcolor: "rgba(29,111,214,0.05)" } }}
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
                        {ageFromIso(p.birthDate) ?? "—"}
                      </TableCell>
                      <TableCell sx={{ color: "text.secondary" }}>
                        {mrnOf(p) ? `#${mrnOf(p)}` : "—"}
                      </TableCell>
                      <TableCell>
                        {hfIds.has(p.id ?? "") ? (
                          <Tooltip title={HF_COHORT_HINT}>
                            <Chip size="small" label="HF Patient" sx={{ bgcolor: "#e7f0fd", color: "#1d6fd6", fontWeight: 600 }} />
                          </Tooltip>
                        ) : (
                          <Tooltip title={NON_HF_COHORT_HINT}>
                            <Chip size="small" label="Non-HF" sx={{ bgcolor: "#eef2f7", color: "#64748b", fontWeight: 600 }} />
                          </Tooltip>
                        )}
                      </TableCell>
                      <TableCell>
                        <RiskChip
                          risk={p.id ? riskById[p.id] : undefined}
                          loading={risksLoading && hfIds.has(p.id ?? "") && !(p.id && riskById[p.id])}
                        />
                      </TableCell>
                      <TableCell align="right" onClick={(e) => e.stopPropagation()}>
                        <Tooltip title="View">
                          <IconButton size="small" onClick={() => navigate(`/patients/${p.id}`)}>
                            <VisibilityOutlinedIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                        <Tooltip title="Edit">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setFormPatient(p);
                              setFormOpen(true);
                            }}
                          >
                            <EditOutlinedIcon fontSize="small" />
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
            flexDirection: "row",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 2,
            px: 2,
            py: 1.5,
            borderTop: "1px solid",
            borderColor: "divider",
          }}
        >
          <Typography variant="body2" color="text.secondary">
            Showing {from}–{to} of {total}
          </Typography>

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
      </Box>

      <PatientFormDialog
        open={formOpen}
        patient={formPatient}
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

/** Small colored status dot used in the cohort filter labels. */
function Dot({ color }: { color: string }) {
  return (
    <Box
      component="span"
      sx={{ width: 8, height: 8, borderRadius: "50%", bgcolor: color, display: "inline-block", mr: 0.75 }}
    />
  );
}
