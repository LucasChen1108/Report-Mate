// Package reports owns service reports: their content, their validation
// against a template, and their export.
//
// # The snapshot is the design
//
// A report stores the template's schema and revision AS THEY WERE AT FILL TIME
// (service_reports.schema_snapshot / template_revision, written once by
// Store.Create and never again). Everything downstream reads that snapshot, not
// the live template: validation, rendering, and export. Templates get edited —
// fields renamed, removed, reordered — and a report someone already signed off
// on must keep rendering exactly as it was signed. Resolving the schema live
// would quietly rewrite history, which is why 0006_service_reports.sql calls
// the denormalization deliberate and asks that it not be "normalized" away.
//
// # Draft saves and complete saves are different operations
//
// ValidateContent takes a requireComplete flag, and getting it backwards makes
// the renderer unusable:
//
//	POST /api/reports, PUT /api/reports/{id}     requireComplete = false
//	POST /api/reports/{id}/save-and-export       requireComplete = true
//
// Autosaving a half-filled form has to succeed. Exporting a report with an
// unanswered required field must not. Structure and type rules apply to both.
//
// # The unknown-key rule is a security boundary
//
// Every key in a report's content must be a field id the schema declares.
// That rule, in ValidateContent, is the enforcement point for the product
// guarantee that "the agent can only write into fields defined by the active
// template's schema" (.kiro/steering/tech.md) — the agent's fill_field tool
// writes through this same function. An unrecognized key is a rejected write.
//
// # Export
//
// save-and-export renders a SELF-CONTAINED HTML document — inline CSS, inline
// images, no external reference — writes it under EXPORT_DIR, and records it as
// an attachments row of kind 'export_html'. It is HTML and not PDF because the
// box this runs on cannot afford a headless browser; a later phase converts
// these snapshots to PDF server-side without changing the endpoint or its
// callers. The save, the parts rewrite, the validation, the status change, the
// file, and the attachments row are ONE transaction: a report is never left
// marked exported with no artifact behind it.
//
// # Shape of the package
//
//	content.go   the Go mirror of the frontend ReportContent, and the
//	             string<->NUMERIC quantity conversion the wire contract needs
//	validate.go  ValidateContent: unknown keys, type match, required fields
//	store.go     service_reports / parts_used / attachments persistence
//	service.go   the save-and-export transaction
//	export.go    the HTML renderer and the export file layout
//	handler.go   the six routes, identity, and error mapping
//
// parts_used and attachments hang off a report (see db/migrations). Report
// content is always keyed to the template's field ids so the manual fill path
// and the agent path share one structure.
package reports
