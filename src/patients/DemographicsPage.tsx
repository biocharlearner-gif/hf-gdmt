import { type ReactNode } from "react";
import { useOutletContext } from "react-router-dom";
import { Box, Chip, IconButton, Paper, Typography } from "@mui/material";
import EditIcon from "@mui/icons-material/Edit";
import MapIcon from "@mui/icons-material/MapOutlined";
import PhoneIcon from "@mui/icons-material/PhoneOutlined";
import EmailIcon from "@mui/icons-material/EmailOutlined";
import { mrnOf, formatDob, type FhirPatient } from "./patientMapper";
import type { PatientOutletContext } from "./PatientViewPage";

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
    <Box sx={{ gridColumn: full ? "1 / -1" : undefined }}>
      <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
        {label}
      </Typography>
      <Typography variant="body1" sx={{ fontWeight: 500 }}>
        {value || "—"}
      </Typography>
    </Box>
  );
}

export default function DemographicsPage() {
  const { patient, onEdit } = useOutletContext<PatientOutletContext>();
  const p: FhirPatient = patient;
  const addr = p.address?.[0];
  const phone = p.telecom?.find((t) => t.system === "phone")?.value;
  const email = p.telecom?.find((t) => t.system === "email")?.value;
  const given = p.name?.[0]?.given ?? [];

  return (
    <Box sx={{ display: "grid", gap: 3, gridTemplateColumns: "2fr 1fr", alignItems: "start" }}>
      <Box sx={{ display: "flex", flexDirection: "column", gap: 3 }}>
        <Card
          title="Basic Info"
          action={
            <IconButton size="small" color="primary" onClick={onEdit}>
              <EditIcon fontSize="small" />
            </IconButton>
          }
        >
          <Box sx={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 2.5 }}>
            <Field label="First Name" value={given[0]} />
            <Field label="Middle Name" value={given.slice(1).join(" ")} />
            <Field label="Last Name" value={p.name?.[0]?.family} />
            <Box>
              <Typography variant="overline" color="text.secondary" sx={{ display: "block" }}>
                Gender
              </Typography>
              <Chip
                size="small"
                label={p.gender ?? "unknown"}
                sx={{ bgcolor: "#cffafe", color: "#0e7490", textTransform: "capitalize" }}
              />
            </Box>
            <Field label="DOB" value={formatDob(p)} />
            <Field label="MRN" value={mrnOf(p)} />
          </Box>
        </Card>

        <Card title="Address" action={<MapIcon fontSize="small" color="primary" />}>
          <Box sx={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 2.5 }}>
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
      </Box>
    </Box>
  );
}
