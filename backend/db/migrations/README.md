# db/migrations/

Ordered, additive SQL migrations for the PostgreSQL schema (AWS Lightsail-managed Postgres).

## Rules

- Files are numbered and applied in order: `0001_users.sql`, `0002_jobs.sql`, ...
- Migrations are **additive**. Once a migration has been applied, don't hand-edit it — add a new one instead.
- Each migration should be independently runnable and, where practical, reversible.

## Applied migrations

| Order | File | Tables / purpose |
| --- | --- | --- |
| 0001 | `0001_users.sql` | `pgcrypto` + `citext` extensions; `users` (id, name, email, role, password hash) |
| 0002 | `0002_jobs.sql` | `jobs` (id, customer, address, scheduled_at, status, assigned technician) |
| 0003 | `0003_report_templates.sql` | `report_templates` (id, name, schema jsonb) |
| 0004 | `0004_seed_report_templates.sql` | the three seed templates (mirrors `internal/templates/seeds.go`) |
| 0005 | `0005_report_templates_revision.sql` | `report_templates.revision` / `created_by` / `archived_at` |
| 0006 | `0006_service_reports.sql` | `service_reports` (template_id + pinned revision + schema snapshot, job, technician, content jsonb, filled_by, status) |
| 0007 | `0007_parts_used.sql` | `parts_used` (report_id, part, numeric quantity) |
| 0008 | `0008_attachments.sql` | `attachments` (report_id, field_id, kind, storage_key) |
| 0009 | `0009_seed_dev_users.sql` | **dev seed** — two fixed-UUID users for the dev identity shim |

Order matters: `service_reports` references `jobs`, `users` and `report_templates`,
so those come first; `parts_used` and `attachments` reference `service_reports`.

Slots `0010` and above are unused and reserved for in-flight work.

## How they are applied

There is no migration CLI. `backend/internal/db.Migrate` embeds this directory
(`embed.go`), applies each unapplied `*.sql` in lexical filename order inside
its own transaction, and records it in `schema_migrations`. The server runs it
at startup, so `go run ./cmd/server` against an empty database is all it takes.

Seed data (realistic jobs + 2–3 demo templates) lives alongside migrations or in a dedicated seed script — needed for the demo and for next week's agent work.
