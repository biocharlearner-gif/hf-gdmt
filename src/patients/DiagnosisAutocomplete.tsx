import { useEffect, useMemo, useState } from "react";
import { Autocomplete, Box, Chip, CircularProgress, TextField, Typography } from "@mui/material";
import { searchSnomedConditions, systemShortName, type ConceptOption } from "./conditionSearch";
import { PROBLEM_OPTIONS } from "./problemList";

/** Curated common diagnoses shown before typing / when the tx server is unreachable. */
const SUGGESTIONS: ConceptOption[] = PROBLEM_OPTIONS.map((o) => ({ ...o.coding }));

function filterSuggestions(q: string): ConceptOption[] {
  const l = q.toLowerCase();
  return SUGGESTIONS.filter((o) => o.display.toLowerCase().includes(l));
}

interface Props {
  value: ConceptOption | null;
  /** Computed cohort for the current value (parent classifies via hfCohort.isHfCode). */
  cohort: "hf" | "non-hf" | null;
  classifying: boolean;
  error?: string;
  onChange: (concept: ConceptOption | null) => void;
}

/**
 * Live SNOMED diagnosis picker. Debounced $expand search against the terminology
 * server, with a curated fallback list. Selecting a concept bubbles up to the parent,
 * which writes the coded Condition and classifies HF vs Non-HF.
 */
export default function DiagnosisAutocomplete({ value, cohort, classifying, error, onChange }: Props) {
  const [input, setInput] = useState("");
  const [options, setOptions] = useState<ConceptOption[]>(SUGGESTIONS);
  const [loading, setLoading] = useState(false);
  const [txDown, setTxDown] = useState(false);

  useEffect(() => {
    const q = input.trim();
    if (q.length < 2) {
      setOptions(SUGGESTIONS);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await searchSnomedConditions(q, ctrl.signal);
        setOptions(res.length ? res : filterSuggestions(q));
        setTxDown(false);
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setTxDown(true);
        setOptions(filterSuggestions(q)); // graceful degradation
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => {
      ctrl.abort();
      clearTimeout(timer);
    };
  }, [input]);

  // Keep the selected value present in the option list (MUI warns otherwise).
  const displayOptions = useMemo(() => {
    if (value && !options.some((o) => o.system === value.system && o.code === value.code)) {
      return [value, ...options];
    }
    return options;
  }, [value, options]);

  return (
    <Box>
      <Autocomplete
        value={value}
        onChange={(_, v) => onChange(v)}
        inputValue={input}
        onInputChange={(_, v) => setInput(v)}
        options={displayOptions}
        loading={loading}
        getOptionLabel={(o) => o.display}
        isOptionEqualToValue={(a, b) => a.system === b.system && a.code === b.code}
        filterOptions={(x) => x} // server-side filtering — don't re-filter locally
        noOptionsText={input.trim().length < 2 ? "Type to search diagnoses…" : "No matching diagnoses"}
        renderOption={(props, o) => (
          <li {...props} key={`${o.system}|${o.code}`}>
            <Box>
              <Typography variant="body2">{o.display}</Typography>
              <Typography variant="caption" color="text.secondary">
                {systemShortName(o.system)} · {o.code}
              </Typography>
            </Box>
          </li>
        )}
        renderInput={(params) => (
          <TextField
            {...params}
            label="Primary Diagnosis"
            required
            size="small"
            placeholder="Search e.g. “heart failure”, “hypertension”…"
            error={Boolean(error)}
            helperText={
              error ??
              (txDown
                ? "Terminology server unavailable — showing common diagnoses."
                : "Search any SNOMED diagnosis. Heart-failure diagnoses enter the GDMT program.")
            }
            slotProps={{
              ...params.slotProps,
              input: {
                ...params.slotProps.input,
                endAdornment: (
                  <>
                    {loading ? <CircularProgress color="inherit" size={16} /> : null}
                    {params.slotProps.input.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />

      {value && (
        <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
          <Typography variant="body2" color="text.secondary">
            This patient will be added as:
          </Typography>
          {classifying ? (
            <CircularProgress size={14} />
          ) : cohort === "hf" ? (
            <Chip size="small" label="HF Patient" sx={{ bgcolor: "#e7f0fd", color: "#1d6fd6", fontWeight: 600 }} />
          ) : (
            <Chip size="small" label="Non-HF Patient" sx={{ bgcolor: "#eef2f7", color: "#64748b", fontWeight: 600 }} />
          )}
        </Box>
      )}
    </Box>
  );
}
