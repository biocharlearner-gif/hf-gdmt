import { useCallback, useEffect, useRef, useState } from "react";
import { searchPatients, type HfFilter } from "./patientApi";
import type { FhirPatient } from "./patientMapper";

export interface Filters {
  /** Single combined search: matches patient name, or an exact MRN if all-digits. */
  query: string;
}

const EMPTY_FILTERS: Filters = { query: "" };

/** Owns list state: filters, paging, data, loading/error, and refetch. */
export function usePatients() {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [page, setPage] = useState(0); // 0-based
  const [pageSize, setPageSize] = useState(10);
  const [hfFilter, setHfFilterState] = useState<HfFilter>("hf");
  const [patients, setPatients] = useState<FhirPatient[]>([]);
  const [hfIds, setHfIds] = useState<Set<string>>(new Set());
  const [total, setTotal] = useState(0);
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

  const [reloadKey, setReloadKey] = useState(0);
  const refetch = useCallback(() => setReloadKey((k) => k + 1), []);

  useEffect(() => {
    let cancelled = false;
    // Data-fetching effect: the synchronous resets here are intentional (the
    // documented "fetch in effect" exception), so silence the cascading-render rule.
    /* eslint-disable react-hooks/set-state-in-effect */
    setLoading(true);
    setError(null);
    /* eslint-enable react-hooks/set-state-in-effect */
    searchPatients({ ...debounced, hfFilter, page, pageSize })
      .then((res) => {
        if (cancelled) return;
        setPatients(res.patients);
        setHfIds(new Set(res.hfIds));
        setTotal(res.total);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Failed to load patients");
        setPatients([]);
        setTotal(0);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [debounced, hfFilter, page, pageSize, reloadKey]);

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
    patients,
    hfIds,
    total,
    pageCount,
    loading,
    error,
    refetch,
  };
}
