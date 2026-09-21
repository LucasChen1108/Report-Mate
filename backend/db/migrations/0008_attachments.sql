-- 0008_attachments.sql
-- Additive migration: creates attachments — photos and signatures captured
-- against a report field, plus rendered HTML/PDF exports of the report itself.
-- Depends on 0006_service_reports.sql.
-- Do not hand-edit once applied; add a new ordered migration instead.
--
-- field_id is nullable and untyped on purpose: a 'photo' or 'signature' row
-- names the template field it belongs to, while an 'export_html'/'export_pdf'
-- row belongs to the whole report and leaves it NULL. It is deliberately not a
-- foreign key — field ids live inside the template schema jsonb, and a report's
-- schema_snapshot pins them independently of later template edits.
CREATE TABLE attachments (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id    UUID REFERENCES service_reports(id) ON DELETE CASCADE,
    field_id     TEXT,
    kind         TEXT NOT NULL CHECK (kind IN ('photo','signature','export_html','export_pdf')),
    storage_key  TEXT NOT NULL,
    content_type TEXT NOT NULL,
    byte_size    BIGINT NOT NULL,
    caption      TEXT NOT NULL DEFAULT '',
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_attachments_report ON attachments (report_id, kind, created_at DESC);
