-- 0005_report_templates_revision.sql
-- Additive migration: adds edit-tracking columns to report_templates.
-- Depends on 0003_report_templates.sql (the table) and 0001_users.sql (created_by).
-- Do not hand-edit once applied; add a new ordered migration instead.
--
-- NAMING — read before touching this column:
-- report_templates.schema is jsonb that already carries its own "version": 1
-- key. That is the schema FORMAT version: it changes only when the shared
-- Template Schema contract itself changes shape, which should be rare and
-- deliberate. The column added here is called "revision" specifically so the
-- two are never confused: revision counts EDITS to one particular template and
-- is bumped by templates.Store.Update on every save. service_reports pins the
-- revision it was filled against. Do not rename it to "version".
ALTER TABLE report_templates
    ADD COLUMN revision    INT  NOT NULL DEFAULT 1,
    ADD COLUMN created_by  UUID REFERENCES users(id) ON DELETE SET NULL,
    ADD COLUMN archived_at TIMESTAMPTZ;

-- Partial index: the template list only ever shows live templates, newest edit
-- first, so archived rows are kept out of the index entirely.
CREATE INDEX idx_report_templates_active ON report_templates (updated_at DESC)
    WHERE archived_at IS NULL;
