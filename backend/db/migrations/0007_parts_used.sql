-- 0007_parts_used.sql
-- Additive migration: creates parts_used, the line items hanging off a report.
-- Depends on 0006_service_reports.sql.
-- Do not hand-edit once applied; add a new ordered migration instead.
--
-- quantity is NUMERIC, not INT: real jobs consume 2.5 m of cable or 0.75 L of
-- refrigerant. An integer column would round the invoice wrong.
--
-- position preserves the order the technician entered the lines in, which the
-- rendered report and the export must reproduce exactly.
CREATE TABLE parts_used (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_id   UUID NOT NULL REFERENCES service_reports(id) ON DELETE CASCADE,
    position    INT  NOT NULL DEFAULT 0,
    part        TEXT NOT NULL,
    part_number TEXT NOT NULL DEFAULT '',
    quantity    NUMERIC(12,3) NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Lines are always read per report in entry order; the lower(part) index backs
-- the agent's get_parts_catalog matching, which is case-insensitive.
CREATE INDEX idx_parts_used_report ON parts_used (report_id, position);
CREATE INDEX idx_parts_used_part   ON parts_used (lower(part));
