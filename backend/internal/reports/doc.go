// Package reports owns service reports, rendering, and export.
//
// Responsibilities (to implement):
//   - CRUD over service_reports (id, job_id, technician_id, template_id,
//     content jsonb keyed to the template's fields, filled_by
//     [agent|manual|mixed], status, timestamps).
//   - Render a template schema + stored content into an editable form model —
//     this is the shared path used by both manual fill and agent-assisted
//     review/edit.
//   - PDF export of a completed report.
//   - Enforce human-in-the-loop: no report reaches "submitted" without an
//     explicit review step.
//
// parts_used and attachments hang off a report (see db/migrations). Report
// content is always keyed to the active template's field ids so manual and
// agent fills share one structure.
package reports
