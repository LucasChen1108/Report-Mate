# db/migrations/

Ordered, additive SQL migrations for the PostgreSQL schema (AWS Lightsail-managed Postgres).

## Rules

- Files are numbered and applied in order: `0001_users.sql`, `0002_jobs.sql`, ...
- Migrations are **additive**. Once a migration has been applied, don't hand-edit it — add a new one instead.
- Each migration should be independently runnable and, where practical, reversible.

## Planned migrations (from tech.md data model)

| Order | File | Tables / purpose |
| --- | --- | --- |
| 0001 | `0001_users.sql` | `users` (id, name, email, role, password hash) — Aarav / auth |
| 0002 | `0002_jobs.sql` | `jobs` (id, customer, address, scheduled_at, status, assigned technician) — Ngiam |
| 0003 | `0003_report_templates.sql` | `report_templates` (id, name, schema jsonb) — Letao & Aaron |
| 0004 | `0004_service_reports.sql` | `service_reports` (id, job_id, technician_id, template_id, content jsonb, filled_by, status, timestamps) — Letao & Aaron |
| 0005 | `0005_parts_used.sql` | `parts_used` (report_id, part, qty) |
| 0006 | `0006_attachments.sql` | `attachments` (report_id, storage_key, type) |

Order matters: `service_reports` references `jobs`, `users`, and `report_templates`, so those come first. `parts_used` and `attachments` reference `service_reports`.

Seed data (realistic jobs + 2–3 demo templates) lives alongside migrations or in a dedicated seed script — needed for the demo and for next week's agent work.
