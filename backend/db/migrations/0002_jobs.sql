-- 0002_jobs.sql
-- Additive migration: creates the jobs table — the field-service work orders a
-- technician fills a report against, and the context source for the agent's
-- get_job_history tool.
-- Depends on 0001_users.sql for the assigned_technician_id reference.
-- Do not hand-edit once applied; add a new ordered migration instead.

-- assigned_technician_id is ON DELETE SET NULL, not CASCADE: removing a user
-- must never destroy the job history a customer's record depends on.
CREATE TABLE jobs (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_name          TEXT NOT NULL,
    site_address           TEXT NOT NULL DEFAULT '',
    scheduled_at           TIMESTAMPTZ,
    status                 TEXT NOT NULL DEFAULT 'scheduled'
                             CHECK (status IN ('scheduled','in_progress','completed','cancelled')),
    assigned_technician_id UUID REFERENCES users(id) ON DELETE SET NULL,
    notes                  TEXT NOT NULL DEFAULT '',
    created_at             TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at             TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- "my jobs", "jobs by status" and the scheduled-descending dispatcher list are
-- the three access patterns the dashboard and technician views actually use.
CREATE INDEX idx_jobs_technician   ON jobs (assigned_technician_id);
CREATE INDEX idx_jobs_status       ON jobs (status);
CREATE INDEX idx_jobs_scheduled_at ON jobs (scheduled_at DESC);
