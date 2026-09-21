-- 0006_service_reports.sql
-- Additive migration: creates service_reports, the filled-in report a
-- technician (or the agent) produces against a template.
-- Depends on 0005 (template_revision), 0003 (report_templates), 0002 (jobs)
-- and 0001 (users).
-- Do not hand-edit once applied; add a new ordered migration instead.
--
-- WHY schema_snapshot IS DENORMALIZED ON PURPOSE:
-- A report stores the exact template schema as it was rendered at fill time,
-- alongside the template_id/template_revision that produced it. Templates get
-- edited — fields renamed, removed, reordered — and a historical report must
-- still render and export exactly as it was signed off. Resolving the schema
-- live from report_templates at read time would silently corrupt past reports.
-- This is a deliberate design decision. Do not "normalize" it away.
--
-- template_id is ON DELETE RESTRICT: a template with reports against it cannot
-- be deleted (archive it instead, see report_templates.archived_at). job_id and
-- technician_id are ON DELETE SET NULL so the report itself survives.
CREATE TABLE service_reports (
    id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id       UUID NOT NULL REFERENCES report_templates(id) ON DELETE RESTRICT,
    template_revision INT  NOT NULL,
    schema_snapshot   JSONB NOT NULL,
    job_id            UUID REFERENCES jobs(id) ON DELETE SET NULL,
    technician_id     UUID REFERENCES users(id) ON DELETE SET NULL,
    title             TEXT NOT NULL DEFAULT '',
    customer_name     TEXT NOT NULL DEFAULT '',
    content           JSONB NOT NULL DEFAULT '{"values":{},"filledBy":"manual"}'::jsonb,
    filled_by         TEXT NOT NULL DEFAULT 'manual'
                        CHECK (filled_by IN ('manual','agent','mixed')),
    status            TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','submitted','exported')),
    submitted_at      TIMESTAMPTZ,
    exported_at       TIMESTAMPTZ,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The dashboard drills down by template, the technician view by "my reports",
-- and both order by newest first; jsonb_path_ops keeps the content GIN index
-- small since we only ever containment-query it.
CREATE INDEX idx_reports_template_created ON service_reports (template_id, created_at DESC);
CREATE INDEX idx_reports_tech_created     ON service_reports (technician_id, created_at DESC);
CREATE INDEX idx_reports_job              ON service_reports (job_id);
CREATE INDEX idx_reports_status           ON service_reports (status);
CREATE INDEX idx_reports_content_gin      ON service_reports USING GIN (content jsonb_path_ops);
