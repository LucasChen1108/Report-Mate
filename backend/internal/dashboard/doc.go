// Package dashboard owns the read-only reporting views over service_reports.
//
// Two screens, three routes:
//
//	GET /api/dashboard/templates             one rollup card per template
//	GET /api/dashboard/templates/{id}        that template's reports as a table
//	GET /api/dashboard/templates/{id}/export.csv  the same table as CSV
//
// The rollup list answers "what have I filed, and against what". It includes
// templates with ZERO reports on purpose: a zero card is the entry point for
// starting the first report against that template, so it must never be joined
// away (see store.go for the two LEFT JOIN traps that silently do exactly that).
//
// The drill-down is the centrepiece: a spreadsheet whose COLUMNS ARE THE
// TEMPLATE'S FIELDS, flattened out of the template's current schema in section
// order, and whose rows are past reports. Two rules make it work:
//
//   - Photo and signature values never leave the database. They are stored as
//     inline base64 data URLs inside service_reports.content, so a single page
//     of rows would otherwise transfer tens of megabytes. The store strips
//     those keys in SQL and returns only a presence flag per attachment field.
//   - Every cell is flattened to a DISPLAY STRING in Go, not in the frontend
//     (cells.go). The table component prints cells[fieldId] and needs zero
//     knowledge of field types, so a new type or a changed display convention
//     is a one-place change here rather than a switch statement in React that
//     someone forgets to update. See frontend/src/api/reportTypes.ts.
//
// SCOPING. Every query in this package is filtered to the calling user with
// `r.technician_id = $me`, unconditionally, for every role. A user sees their
// own reports and nobody else's. The identity comes from the request context,
// put there by the auth package's cookie-session middleware
// (internal/auth/middleware.go);
// requireUser answers 401 when it is absent rather than substituting a default.
//
// The package is strictly read-only — every write path belongs to templates or
// reports — and it owns its own SQL against service_reports rather than
// importing the reports package, so the two stay independently buildable.
package dashboard
