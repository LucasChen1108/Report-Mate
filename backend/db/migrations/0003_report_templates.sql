-- 0003_report_templates.sql
-- Additive migration: creates the report_templates table for the Template Builder.
-- report_templates stores the shared Template Schema as jsonb (Req 5.1, 5.5, 7.3).
-- Do not hand-edit once applied; add a new ordered migration instead.

CREATE TABLE report_templates (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name        TEXT NOT NULL CHECK (length(trim(name)) > 0),
    schema      JSONB NOT NULL,
    is_seed     BOOLEAN NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_report_templates_updated_at ON report_templates (updated_at DESC);
