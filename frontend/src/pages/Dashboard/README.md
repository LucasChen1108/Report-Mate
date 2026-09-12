# pages/Dashboard/

Dispatcher-facing central view of past jobs and report history, plus template
management. Dispatcher-only route.

## What it does

- Past jobs list with filter/search.
- History summary view: rollups by customer or by technician.
- Drill into a job → its linked service reports.
- Entry point to template management (create/edit via TemplateBuilder).

## Notes

- Reads the same job/history data the agent uses as its context source — build on
  the shared `src/api/` client, don't duplicate query logic.
- Dispatcher-admin role only; gated by RBAC on both frontend routing and backend.

Owner: Ngiam (central management / history). Job→report linking depends on the
`service_reports` table (Letao & Aaron).
