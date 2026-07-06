import { useEffect, useState, type ReactNode } from "react";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  TextField,
  Typography,
} from "@mui/material";
import BadgeOutlinedIcon from "@mui/icons-material/BadgeOutlined";
import ContactMailOutlinedIcon from "@mui/icons-material/ContactMailOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import CloseIcon from "@mui/icons-material/Close";
import {
  patientSchema,
  emptyPatientForm,
  type PatientFormValues,
} from "./patientSchema";
import { formToPatient, patientToForm, type FhirPatient } from "./patientMapper";
import { createPatient, mrnExists, updatePatient } from "./patientApi";

interface Props {
  open: boolean;
  /** When provided, the dialog is in Edit mode for this patient. */
  patient?: FhirPatient | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

const GENDERS = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
  { value: "other", label: "Other" },
  { value: "unknown", label: "Unknown" },
] as const;

/** Blue, uppercase section header with an icon and a separating rule. */
function SectionHeader({ icon, title }: { icon: ReactNode; title: string }) {
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, color: "primary.main", mb: 1 }}>
        {icon}
        <Typography variant="overline" sx={{ fontWeight: 700 }}>
          {title}
        </Typography>
      </Box>
      <Divider />
    </Box>
  );
}

export default function PatientFormDialog({ open, patient, onClose, onSaved }: Props) {
  const isEdit = Boolean(patient?.id);
  const [submitting, setSubmitting] = useState(false);

  const {
    control,
    register,
    handleSubmit,
    reset,
    setError,
    formState: { errors },
  } = useForm<PatientFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(patientSchema) as any,
    defaultValues: emptyPatientForm,
    mode: "onTouched",
  });

  // Reset the form whenever the dialog opens (prefill on edit, blank on add).
  useEffect(() => {
    if (open) reset(patient ? patientToForm(patient) : emptyPatientForm);
  }, [open, patient, reset]);

  const onSubmit = async (values: PatientFormValues) => {
    setSubmitting(true);
    try {
      // MRN uniqueness is a server check, not part of zod.
      if (await mrnExists(values.mrn.trim(), patient?.id)) {
        setError("mrn", { message: "Medical Record Number already exists" });
        return;
      }
      const resource = formToPatient(values, patient?.id);
      if (isEdit && patient?.id) {
        await updatePatient(patient.id, resource);
        onSaved("Patient updated");
      } else {
        await createPatient(resource);
        onSaved("Patient added");
      }
      onClose();
    } catch (e) {
      setError("root", {
        message: e instanceof Error ? e.message : "Failed to save patient",
      });
    } finally {
      setSubmitting(false);
    }
  };

  const text = (name: keyof PatientFormValues, label: string, required = false) => (
    <TextField
      label={label}
      required={required}
      fullWidth
      size="small"
      error={Boolean(errors[name])}
      helperText={errors[name]?.message}
      {...register(name)}
    />
  );

  const grid = { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 2 } as const;
  const fullSpan = { gridColumn: "1 / -1" } as const;

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth slotProps={{ paper: { sx: { borderRadius: 2 } } }}>
      <DialogTitle sx={{ pb: 1 }}>
        <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <Box>
            <Typography variant="h6" color="primary" sx={{ fontWeight: 700 }}>
              {isEdit ? "Edit Patient" : "Add New Patient"}
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Enter the patient's medical and contact details below.
            </Typography>
          </Box>
          <IconButton onClick={onClose} size="small">
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>
      <form onSubmit={handleSubmit(onSubmit)} noValidate>
        <DialogContent dividers>
          <SectionHeader icon={<BadgeOutlinedIcon fontSize="small" />} title="Personal Information" />
          <Box sx={grid}>
            {text("firstName", "First Name", true)}
            {text("middleName", "Middle Name")}
            {text("lastName", "Last Name", true)}

            <Controller
              control={control}
              name="gender"
              render={({ field }) => (
                <TextField
                  select
                  label="Gender"
                  required
                  fullWidth
                  size="small"
                  value={field.value ?? ""}
                  onChange={field.onChange}
                  onBlur={field.onBlur}
                  error={Boolean(errors.gender)}
                  helperText={errors.gender?.message}
                >
                  {GENDERS.map((g) => (
                    <MenuItem key={g.value} value={g.value}>
                      {g.label}
                    </MenuItem>
                  ))}
                </TextField>
              )}
            />
            <TextField
              label="Date of Birth (MM-DD-YYYY)"
              required
              fullWidth
              size="small"
              placeholder="MM-DD-YYYY"
              error={Boolean(errors.dob)}
              helperText={errors.dob?.message}
              {...register("dob")}
            />
            {text("mrn", "Medical Record Number (MRN)", true)}
          </Box>

          <Box sx={{ height: 24 }} />

          <SectionHeader icon={<ContactMailOutlinedIcon fontSize="small" />} title="Contact & Address" />
          <Box sx={grid}>
            <Box sx={{ gridColumn: "span 1" }}>{text("phone", "Phone Number")}</Box>
            <Box sx={{ gridColumn: "span 2" }}>{text("email", "Email Address")}</Box>
            <Box sx={fullSpan}>{text("addressLine", "Address Line")}</Box>
            {text("city", "City")}
            {text("state", "State")}
            {text("zip", "Zip Code")}
            <Box sx={fullSpan}>{text("country", "Country")}</Box>
          </Box>

          {errors.root?.message && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {errors.root.message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 3, py: 2 }}>
          <Button color="inherit" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="submit" variant="contained" startIcon={<SaveOutlinedIcon />} disabled={submitting}>
            {submitting ? "Saving…" : "Save Patient"}
          </Button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
