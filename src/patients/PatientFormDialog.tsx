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
import MedicalInformationOutlinedIcon from "@mui/icons-material/MedicalInformationOutlined";
import SaveOutlinedIcon from "@mui/icons-material/SaveOutlined";
import CloseIcon from "@mui/icons-material/Close";
import {
  patientSchema,
  emptyPatientForm,
  type PatientFormValues,
} from "./patientSchema";
import { formToPatient, formToCondition, patientToForm, type FhirPatient } from "./patientMapper";
import { createPatient, createResource, mrnExists, updatePatient } from "./patientApi";
import { isHfCode } from "./hfCohort";
import { HF_COHORT_HINT, NON_HF_COHORT_HINT } from "./problemList";
import DiagnosisAutocomplete from "./DiagnosisAutocomplete";
import type { ConceptOption } from "./conditionSearch";

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
    clearErrors,
    formState: { errors },
  } = useForm<PatientFormValues>({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    resolver: zodResolver(patientSchema) as any,
    defaultValues: emptyPatientForm,
    mode: "onTouched",
  });

  // The diagnosis picked from the terminology search + its computed cohort. Held in
  // component state (not the RHF form) since it's a coded concept, not a text field.
  const [concept, setConcept] = useState<ConceptOption | null>(null);
  const [cohort, setCohort] = useState<"hf" | "non-hf" | null>(null);
  const [classifying, setClassifying] = useState(false);

  // Reset the form (and the diagnosis) whenever the dialog opens.
  useEffect(() => {
    if (open) {
      reset(patient ? patientToForm(patient) : emptyPatientForm);
      setConcept(null);
      setCohort(null);
    }
  }, [open, patient, reset]);

  // Classify the chosen diagnosis HF vs Non-HF against the cohort value set.
  const handleConceptChange = async (next: ConceptOption | null) => {
    setConcept(next);
    clearErrors("problem");
    if (!next) {
      setCohort(null);
      return;
    }
    setClassifying(true);
    try {
      setCohort((await isHfCode(next)) ? "hf" : "non-hf");
    } catch {
      setCohort("non-hf"); // if the tx check fails, don't over-claim HF membership
    } finally {
      setClassifying(false);
    }
  };

  const onSubmit = async (values: PatientFormValues) => {
    // Diagnosis is required only in Add mode (the Edit flow doesn't manage it).
    if (!isEdit && !concept) {
      setError("problem", { message: "Select the patient's primary diagnosis" });
      return;
    }
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
        const created = await createPatient(resource);
        // Write the diagnosis as a coded Condition so the patient shows up and is
        // classified HF / Non-HF. Patient already exists, so a Condition failure is
        // a soft warning rather than a hard error.
        try {
          const condition = created.id ? formToCondition(concept, created.id) : null;
          if (condition) await createResource(condition);
          onSaved("Patient added");
        } catch {
          onSaved("Patient added, but the diagnosis could not be saved");
        }
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

          {/* Problem list — Add mode only. Drives whether the patient is HF or Non-HF,
              and (via the demo tag) whether they appear on the roster at all. */}
          {!isEdit && (
            <>
              <Box sx={{ height: 24 }} />
              <SectionHeader
                icon={<MedicalInformationOutlinedIcon fontSize="small" />}
                title="Problem List / Diagnosis"
              />

              <DiagnosisAutocomplete
                value={concept}
                cohort={cohort}
                classifying={classifying}
                error={errors.problem?.message as string | undefined}
                onChange={handleConceptChange}
              />

              {/* Explain what the two cohorts mean (requirement #2). */}
              <Alert severity="info" icon={false} sx={{ mt: 2, bgcolor: "#f5f8fd" }}>
                <Typography variant="body2" sx={{ mb: 0.5 }}>
                  <Box component="span" sx={{ fontWeight: 700, color: "#1d6fd6" }}>
                    HF Patient
                  </Box>{" "}
                  — {HF_COHORT_HINT}
                </Typography>
                <Typography variant="body2">
                  <Box component="span" sx={{ fontWeight: 700, color: "#64748b" }}>
                    Non-HF Patient
                  </Box>{" "}
                  — {NON_HF_COHORT_HINT}
                </Typography>
              </Alert>
            </>
          )}

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
