# db/migrations/

Ordered, additive SQL migrations for the PostgreSQL schema.

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
| 0009 | `0009_seed_dev_users.sql` | Historical development seed; excluded from the production schema stream |
| 0010 | `0010_seed_dev_credentials.sql` | Historical development credentials; excluded from the production schema stream |
| 0011 | `0011_disable_legacy_dev_credentials.sql` | Clears the known hashes if the historical seeds reached an existing database |
| 0012 | `0012_stage_b_accounts.sql` | Companies, account ownership, global login identities, authorization codes, and opaque sessions |

Order matters: `service_reports` references `jobs`, `users` and `report_templates`,
so those come first; `parts_used` and `attachments` reference `service_reports`.

Migrations `0001` through `0012` must be treated as applied/immutable unless the
team has positive evidence that a target database never applied them. New Stage
B migrations start at `0013`.

## Stage B account model

The legacy `users.email` column remains temporarily for compatibility with the
pre-Stage-B auth store. `user_login_emails` is the new authoritative identity
index: it stores one normalized row for each personal or company email and its
primary key enforces global cross-kind uniqueness. New account code must insert
both identity rows in the same transaction as the user.

Existing users are assigned to the clearly named `Legacy imported accounts`
company instead of guessing real company or manager relationships. Their one
known email is imported as a company identity, and their published password is
disabled by migration `0011`. They are migration-compatible historical owners,
not production-ready Stage B accounts.

New table UUIDs intentionally have no database default. Stage B stores generate
them in the application so the schema does not add another extension
dependency. Authorization codes and sessions store only 32-byte hashes; the raw
values exist only in the creating response or cookie.

## How they are applied

There is no migration CLI. `backend/internal/db.Migrate` consumes the
production-safe `migrations.SchemaFS`, applies each unapplied schema migration
in lexical filename order inside its own transaction, and records it in
`schema_migrations`. The server runs it at startup, so `go run ./cmd/server`
against an empty database is all it takes.

`0009` and `0010` remain embedded only as immutable historical files. They are
filtered out of `SchemaFS` and cannot run during normal server startup. To
install the disposable accounts on a local development database, explicitly
run:

```bash
ENV=development go run ./cmd/devseed
```

The command refuses production, staging, test, and blank environment values.
It applies the two fixture files in one transaction without recording them as
schema migrations. `0011` safely invalidates their published password in any
database that received the old unconditional seeds; rerun `devseed` afterwards
only on a disposable development database that intentionally needs them.
