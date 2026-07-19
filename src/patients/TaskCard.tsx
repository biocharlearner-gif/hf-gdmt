import { useRef, useState } from "react";
import { Box, Button, Chip, CircularProgress, Collapse, Divider, Link, Paper, TextField, Typography } from "@mui/material";
import AssignmentIcon from "@mui/icons-material/AssignmentOutlined";
import PersonIcon from "@mui/icons-material/PersonOutlineOutlined";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import { saveTask, type FhirResource } from "./patientApi";
import { CURRENT_USER } from "./currentUser";
import VitalTrendDetail from "./VitalTrendDetail";
import CitationLine from "./CitationLine";
import { isKnownCitation, VITAL_CITATION_REF } from "../engine/citations";

/**
 * One Task, with the full clinician workflow and a lazy expandable trend panel for the
 * vital it concerns. Shared by the global Tasks page and the patient-view Tasks tab.
 *
 * Workflow: requested → (Accept → assigned to current user) accepted → (Start)
 * in-progress → (Mark complete, needs action notes) completed. Cancel at any active
 * step requires a reason. Action notes auto-save while in-progress.
 */

type VitalKey = "weight" | "bloodPressure" | "heartRate" | "spo2";

const STATUS_COLOR: Record<string, { bg: string; fg: string }> = {
  requested: { bg: "#fef3c7", fg: "#b45309" },
  accepted: { bg: "#e0f2fe", fg: "#0369a1" },
  "in-progress": { bg: "#dbeafe", fg: "#1d4ed8" },
  completed: { bg: "#dcfce7", fg: "#15803d" },
  cancelled: { bg: "#f1f5f9", fg: "#64748b" },
  rejected: { bg: "#fee2e2", fg: "#b91c1c" },
};
const PRIORITY_COLOR: Record<string, string> = { urgent: "#b91c1c", asap: "#b45309", routine: "#64748b" };
const VITAL_LABEL: Record<string, string> = { weight: "weight", bloodPressure: "blood pressure", heartRate: "heart rate", spo2: "oxygen saturation" };

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}
function taskTitle(t: FhirResource): string {
  return str(t.description) ?? (t.code as { text?: string } | undefined)?.text ?? "Task";
}
function taskNote(t: FhirResource): string | undefined {
  // The original alert note has no author; the action note carries authorString.
  const notes = (t.note as Array<{ text?: string; authorString?: string }> | undefined) ?? [];
  return notes.find((n) => !n.authorString)?.text;
}
/** The note with any trailing "(Source: …)" stripped — the source is rendered as a link instead. */
function noteWithoutSource(note: string | undefined): string | undefined {
  return note ? note.replace(/\s*\(Source:[^)]*\)\s*/g, " ").trim() || undefined : note;
}
/**
 * Best citation ref for a Task's source link: a known citation id embedded in the note
 * ("(Source: <id>)", used by GDMT-gap and app-created alert Tasks), else the ref for the
 * alert's vital (covers seeded Tasks whose note only says a generic source).
 */
function citationRefOf(t: FhirResource): string | undefined {
  const m = /\(Source:\s*([^)]+)\)/.exec(taskNote(t) ?? "");
  const raw = m?.[1]?.trim();
  if (raw && isKnownCitation(raw)) return raw;
  const vital = alertVitalOf(t);
  return vital ? VITAL_CITATION_REF[vital] : undefined;
}
function actionNoteOf(t: FhirResource): string {
  const notes = (t.note as Array<{ text?: string; authorString?: string }> | undefined) ?? [];
  return notes.find((n) => n.authorString)?.text ?? "";
}
function withActionNote(t: FhirResource, text: string): FhirResource {
  const notes = [...((t.note as Array<{ text?: string; authorString?: string }> | undefined) ?? [])];
  const idx = notes.findIndex((n) => n.authorString);
  const entry = { text, authorString: CURRENT_USER.display, time: new Date().toISOString() };
  if (idx >= 0) notes[idx] = entry;
  else notes.push(entry);
  return { ...t, note: notes };
}
export function alertVitalOf(t: FhirResource): VitalKey | undefined {
  const text = (t.code as { text?: string } | undefined)?.text ?? "";
  const m = /^HF remote-monitoring alert:\s*(.+)$/.exec(text);
  const v = m?.[1]?.trim();
  return v === "weight" || v === "bloodPressure" || v === "heartRate" || v === "spo2" ? v : undefined;
}
function fmtDate(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export default function TaskCard({
  task,
  patientId,
  activeAlertVitals,
  onChanged,
}: {
  task: FhirResource;
  patientId: string;
  activeAlertVitals: Set<string> | null;
  onChanged: (updated: FhirResource) => void;
}) {
  const status = str(task.status) ?? "unknown";
  const sc = STATUS_COLOR[status] ?? { bg: "#f1f5f9", fg: "#64748b" };
  const priority = str(task.priority);
  const owner = (task.owner as { display?: string } | undefined)?.display;
  const reason = (task.statusReason as { text?: string } | undefined)?.text;
  const vital = alertVitalOf(task);
  const citationRef = citationRefOf(task);

  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [notes, setNotes] = useState(actionNoteOf(task));
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [notesSaving, setNotesSaving] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const savedNotes = useRef(actionNoteOf(task));

  const apply = async (changes: Partial<FhirResource>) => {
    setBusy(true);
    try {
      const updated = await saveTask({ ...task, ...changes });
      onChanged(updated);
    } finally {
      setBusy(false);
    }
  };

  /** Save ONLY the action notes (never touches status). */
  const saveNotes = async () => {
    setNotesSaving(true);
    try {
      const updated = await saveTask(withActionNote(task, notes));
      onChanged(updated);
      savedNotes.current = notes;
      setSavedAt(new Date().toLocaleTimeString());
    } finally {
      setNotesSaving(false);
    }
  };
  const notesDirty = notes !== savedNotes.current;

  const outcome = vital && activeAlertVitals ? (activeAlertVitals.has(vital) ? "still abnormal" : "improved") : null;

  return (
    <Paper variant="outlined" sx={{ borderRadius: 2, borderLeft: "4px solid", borderLeftColor: sc.fg }}>
      <Box sx={{ p: 2.5 }}>
        <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
          <AssignmentIcon fontSize="small" sx={{ color: "text.secondary", mt: 0.4 }} />
          <Box sx={{ flexGrow: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>{taskTitle(task)}</Typography>
            {noteWithoutSource(taskNote(task)) && (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>{noteWithoutSource(taskNote(task))}</Typography>
            )}
            {citationRef && <CitationLine citationRef={citationRef} />}
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mt: 0.75, flexWrap: "wrap" }}>
              {owner && (
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, color: "text.secondary" }}>
                  <PersonIcon sx={{ fontSize: 15 }} />
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>{owner}</Typography>
                </Box>
              )}
              <Typography variant="caption" color="text.disabled">
                Authored {fmtDate(str(task.authoredOn))}
                {task.lastModified ? ` · Updated ${fmtDate(str(task.lastModified))}` : ""}
              </Typography>
            </Box>
            {reason && <Typography variant="caption" sx={{ display: "block", color: sc.fg, mt: 0.25 }}>{reason}</Typography>}
            {outcome && (
              <Chip
                size="small"
                label={`Outcome: ${VITAL_LABEL[vital!] ?? vital} ${outcome}`}
                sx={{ mt: 0.75, fontWeight: 700, bgcolor: outcome === "improved" ? "#dcfce7" : "#fee2e2", color: outcome === "improved" ? "#15803d" : "#b91c1c" }}
              />
            )}
          </Box>
          <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 0.5 }}>
            <Chip size="small" label={status} sx={{ bgcolor: sc.bg, color: sc.fg, fontWeight: 700, textTransform: "capitalize" }} />
            {priority && priority !== "routine" && (
              <Typography variant="caption" sx={{ color: PRIORITY_COLOR[priority] ?? "text.secondary", fontWeight: 700, textTransform: "uppercase" }}>
                {priority}
              </Typography>
            )}
          </Box>
        </Box>

        <Divider sx={{ my: 1.75 }} />

        {/* Action area — depends on status */}
        {busy ? (
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <CircularProgress size={16} /> <Typography variant="caption" color="text.secondary">Updating…</Typography>
          </Box>
        ) : cancelling ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <TextField
              size="small"
              label="Reason for cancellation (required)"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              autoFocus
              fullWidth
            />
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="small"
                variant="contained"
                color="error"
                disabled={!cancelReason.trim()}
                onClick={() => apply({ status: "cancelled", statusReason: { text: cancelReason.trim() } })}
              >
                Confirm cancel
              </Button>
              <Button size="small" onClick={() => { setCancelling(false); setCancelReason(""); }}>Back</Button>
            </Box>
          </Box>
        ) : status === "requested" || status === "received" || status === "ready" ? (
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button size="small" variant="contained" onClick={() => apply({ status: "accepted", owner: { display: CURRENT_USER.display } })}>
              Accept + assign to me
            </Button>
            <Button size="small" color="inherit" variant="outlined" onClick={() => setCancelling(true)}>Cancel</Button>
          </Box>
        ) : status === "accepted" ? (
          <Box sx={{ display: "flex", gap: 1 }}>
            <Button size="small" variant="contained" onClick={() => apply({ status: "in-progress" })}>Start</Button>
            <Button size="small" color="inherit" variant="outlined" onClick={() => setCancelling(true)}>Cancel</Button>
          </Box>
        ) : status === "in-progress" ? (
          <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
            <TextField
              size="small"
              label="Action taken notes"
              placeholder="Record the action taken…"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              multiline
              minRows={2}
              fullWidth
            />
            <Typography variant="caption" color={notesDirty ? "warning.main" : "text.secondary"}>
              {notesSaving ? "Saving…" : notesDirty ? "Unsaved changes" : savedAt ? `Notes saved at ${savedAt}` : " "}
            </Typography>
            <Box sx={{ display: "flex", gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                disabled={notesSaving || !notesDirty}
                onClick={saveNotes}
              >
                Save Task Notes
              </Button>
              <Button
                size="small"
                variant="contained"
                color="success"
                disabled={!notes.trim()}
                onClick={() => apply(withActionNote({ ...task, status: "completed" }, notes.trim()))}
              >
                Mark complete
              </Button>
              <Button size="small" color="inherit" variant="outlined" onClick={() => setCancelling(true)}>Cancel</Button>
            </Box>
          </Box>
        ) : (
          <Typography variant="caption" color="text.secondary">No further actions — task is {status}.</Typography>
        )}

        {/* Lazy vital trend (only mounts when expanded) */}
        {vital && (
          <>
            <Divider sx={{ my: 1.5 }} />
            <Link component="button" type="button" underline="none" onClick={() => setExpanded((x) => !x)} sx={{ display: "inline-flex", alignItems: "center", gap: 0.5, fontWeight: 600 }}>
              <ExpandMoreIcon sx={{ fontSize: 18, transform: expanded ? "rotate(180deg)" : "none", transition: "transform .2s" }} />
              {expanded ? "Hide" : "Show"} {VITAL_LABEL[vital] ?? vital} trend &amp; readings
            </Link>
            <Collapse in={expanded} unmountOnExit>
              <Box sx={{ mt: 1.5 }}>
                <VitalTrendDetail patientId={patientId} vital={vital} />
              </Box>
            </Collapse>
          </>
        )}
      </Box>
    </Paper>
  );
}
