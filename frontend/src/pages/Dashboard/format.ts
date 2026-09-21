// format.ts — the dashboard's date/number presentation helpers.
//
// Small and shared: the rollup cards, the report table, and the filter bar all
// print the same timestamps, and three components formatting dates three
// slightly different ways is exactly the kind of drift a demo audience notices.
//
// NOTE what is NOT here: anything that formats a CELL value. Cells arrive from
// the backend already flattened to display strings (see the long comment at the
// top of api/reportTypes.ts) and the table prints them verbatim. Adding a
// type-aware cell formatter here would re-introduce the frontend/backend
// formatting split that contract exists to remove.

// Wall-clock date for a row or card, e.g. "21 Sep 2026". Locale-aware, so it
// reads correctly for whoever is looking at it.
export function formatDate(iso: string | null): string {
  const date = parseIso(iso);
  if (!date) return "—";
  return date.toLocaleDateString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

// Date + time, used in the row title attribute so a user can get the precise
// moment without the table carrying an extra column for it.
export function formatDateTime(iso: string | null): string {
  const date = parseIso(iso);
  if (!date) return "Unknown date";
  return date.toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// "Last activity" on a template card: "3 days ago", "just now", "Never".
//
// Deliberately coarse. A card is a glanceable summary — "2 hours ago" answers
// "is anyone using this template?" better than a timestamp does, and the exact
// value is one click away in the table.
export function formatRelativeTime(iso: string | null, now = Date.now()): string {
  const date = parseIso(iso);
  if (!date) return "Never";

  const deltaMs = now - date.getTime();
  const seconds = Math.round(deltaMs / 1000);

  // A clock skew between the server and the browser can put a just-created
  // report a few seconds in the future; show "just now" rather than "in 4
  // seconds", which reads like a bug.
  if (seconds < 60) return "just now";

  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} ${plural(hours, "hour")} ago`;

  const days = Math.round(hours / 24);
  if (days < 7) return `${days} ${plural(days, "day")} ago`;

  const weeks = Math.round(days / 7);
  if (days < 30) return `${weeks} ${plural(weeks, "week")} ago`;

  const months = Math.round(days / 30);
  if (days < 365) return `${months} ${plural(months, "month")} ago`;

  const years = Math.round(days / 365);
  return `${years} ${plural(years, "year")} ago`;
}

export function plural(count: number, noun: string): string {
  return count === 1 ? noun : `${noun}s`;
}

// A status string from the backend ("draft" | "submitted" | "exported", but
// typed as a bare string in the contract) as a capitalized label.
export function formatStatus(status: string): string {
  if (!status) return "—";
  return status.charAt(0).toUpperCase() + status.slice(1);
}

// Tolerant ISO parse: returns null for null, "", and anything Date rejects, so
// every caller above degrades to a placeholder instead of printing
// "Invalid Date" into the UI.
function parseIso(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? null : date;
}
