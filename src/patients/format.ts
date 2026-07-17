/**
 * Number/date formatting shared by the patient tabs. Kept apart from sparkline.tsx
 * because that file exports components, and react-refresh requires component files to
 * export only components.
 */

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "16 Jul 2026, 14:05" — for readings where the time of day matters. */
export function fmtDate(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

/** "16 Jul 2026" — for results where the day is enough. */
export function fmtDay(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function fmtTime(iso?: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "" : d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}
