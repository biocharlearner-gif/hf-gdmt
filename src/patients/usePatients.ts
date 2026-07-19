import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listCohort, type HfFilter } from "./patientApi";
import { fetchPatientRisk } from "./patientRisk";
import { fullName, type FhirPatient } from "./patientMapper";
import type { RiskScore } from "../engine/risk";

export interface Filters {
  /** Single combined search: matches patient name, or an exact MRN if all-digits. */
  query: string;
}

/** List ordering: sickest-first by HF risk (default), or alphabetical by name. */
export type SortBy = "risk" | "name";

const EMPTY_FILTERS: Filters = { query: "" };

/** Owns list state: filters, paging, sort, per-patient risk, loading/error, and refetch. */
export function usePatients() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0); // 0-based
  const [pageSize, setPageSize] = useState(10);
  const [hfFilter, setHfFilterState] = useState<HfFilter>("hf");
  const [sortBy, setSortByState] = useState<SortBy>("risk");
  /** Full filtered cohort (name-sorted); paging/risk-sort happen locally below. */
  const [allPatients, setAllPatients] = useState<FhirPatient[]>([]);
  const [hfIds, setHfIds] = useState<Set<string>>(new Set());
  /** Per-patient HF risk, filled progressively as each patient's vitals resolve. */
  const [riskById, setRiskById] = useState<Record<string, RiskScore>>({});
  const [risksLoading, setRisksLoading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Debounce filter changes so typing doesn't fire a request per keystroke.
  const [debounced, setDebounced] = useState<Filters>(EMPTY_FILTERS);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setDebounced(filters);
      setPage(0); // reset to first page on filter change
    }, 400);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [filters]);

  /** Session cache of computed risk (keyed by patient id) so toggling filters doesn't refetch. */
  const riskCache = useRef<Map<string, RiskScore>>(new Map());

  const [reloadKey, setReloadKey] = useState(0);
  // Explicit refresh (after add/delete) recomputes risk, so drop the cache first.
  const refetch = useCallback(() => {
    riskCache.current.clear();
    setReloadKey((k) => k + 1);
  }, []);
  /** Bumped on every cohort load; async risk steps from a superseded run are ignored. */
  const loadSeq = useRef(0);

  useEffect(() => {
    const seq = ++loadSeq.current;
    const alive = () => seq === loadSeq.current;
    // Data-fetching effect: synchronous resets here are the documented exception.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */

    (async () => {
      const { patients, hfIds: ids } = await listCohort({ query: debounced.query, hfFilter });
      if (!alive()) return;
      const hfIdSet = new Set(ids);
      setAllPatients(patients);
      setHfIds(hfIdSet);
      // Seed risk from cache so already-scored patients render instantly.
      setRiskById(Object.fromEntries(riskCache.current));
      setLoading(false);

      // Only HF-cohort patients get a score; fetch sequentially — the public HAPI
      // server drops concurrent request bursts (same constraint as the Tasks page).
      const pending = patients.filter((p) => p.id && hfIdSet.has(p.id) && !riskCache.current.has(p.id));
      if (pending.length === 0) return;
      setRisksLoading(true);
      for (const p of pending) {
        const pid = p.id;
        if (!pid) continue;
        const risk = await fetchPatientRisk(pid).catch(() => undefined);
        if (!alive()) return; // a newer load superseded this one
        if (risk) {
          riskCache.current.set(pid, risk);
          setRiskById((prev) => ({ ...prev, [pid]: risk }));
        }
      }
      if (alive()) setRisksLoading(false);
    })().catch((e: unknown) => {
      if (!alive()) return;
      setError(e instanceof Error ? e.message : "Failed to load patients");
      setAllPatients([]);
      setRisksLoading(false);
      setLoading(false);
    });
    // No cleanup needed: the next run bumps `loadSeq`, so this run's `alive()` turns
    // false and its in-flight risk loop stops on its own.
  }, [debounced, hfFilter, reloadKey]);

  const total = allPatients.length;

  /** Full list ordered by the active sort (risk desc, else name). */
  const sorted = useMemo(() => {
    if (sortBy === "name") return allPatients; // listCohort already name-sorts
    return [...allPatients].sort((a, b) => {
      const ra = a.id ? riskById[a.id]?.score ?? -1 : -1;
      const rb = b.id ? riskById[b.id]?.score ?? -1 : -1;
      return rb - ra || fullName(a).localeCompare(fullName(b));
    });
  }, [allPatients, riskById, sortBy]);

  const patients = useMemo(
    () => sorted.slice(page * pageSize, page * pageSize + pageSize),
    [sorted, page, pageSize],
  );

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return {
    filters,
    setFilters,
    page,
    setPage,
    pageSize,
    setPageSize: (n: number) => {
      setPageSize(n);
      setPage(0);
    },
    hfFilter,
    setHfFilter: (f: HfFilter) => {
      setHfFilterState(f);
      setPage(0);
    },
    sortBy,
    setSortBy: (s: SortBy) => {
      setSortByState(s);
      setPage(0);
    },
    patients,
    hfIds,
    riskById,
    risksLoading,
    total,
    pageCount,
    loading,
    error,
    refetch,
  };
}
