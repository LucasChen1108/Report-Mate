-- 0012_seed_jobs.sql
-- Additive migration: seeds realistic jobs so the AI agent's get_job_history
-- tool (internal/jobs JobHistoryProvider) returns useful past-visit context in
-- the demo, and so the dispatcher dashboard has data to show. Depends on
-- 0002_jobs.sql (jobs table) and 0009_seed_dev_users.sql (the technician the
-- jobs are assigned to).
--
-- Do not hand-edit once applied; add a new ordered migration instead.
--
-- ############################ DEV/DEMO SEED DATA ############################
-- The customer names are chosen so several customers have MULTIPLE jobs on
-- different dates: that is what makes "this customer's past jobs" non-empty when
-- the agent resolves a job to its customer and asks for their history. Fixed
-- UUIDs so the rows are stable to reference; assigned to the seeded dev
-- technician (11111111-…). scheduled_at is spread across recent months so the
-- history reads like a real service record. Matched on id via ON CONFLICT so
-- re-running is a no-op.

INSERT INTO jobs (id, customer_name, site_address, scheduled_at, status, assigned_technician_id, notes) VALUES
    -- Acme Manufacturing — three visits, a recurring HVAC customer.
    ('a0000000-0000-0000-0000-000000000001', 'Acme Manufacturing', '120 Industrial Way, Unit 4',
        now() - interval '120 days', 'completed', '11111111-1111-1111-1111-111111111111',
        'Annual rooftop unit service. Replaced run capacitor; airflow restored.'),
    ('a0000000-0000-0000-0000-000000000002', 'Acme Manufacturing', '120 Industrial Way, Unit 4',
        now() - interval '55 days', 'completed', '11111111-1111-1111-1111-111111111111',
        'Return visit: intermittent compressor rattle. Installed hard-start kit.'),
    ('a0000000-0000-0000-0000-000000000003', 'Acme Manufacturing', '120 Industrial Way, Unit 4',
        now() + interval '7 days', 'scheduled', '11111111-1111-1111-1111-111111111111',
        'Follow-up: check refrigerant charge after last repair.'),

    -- Bayside Dental — two visits.
    ('b0000000-0000-0000-0000-000000000001', 'Bayside Dental', '88 Marine Parade Rd, #02-15',
        now() - interval '90 days', 'completed', '11111111-1111-1111-1111-111111111111',
        'Split system not cooling. Cleared condensate drain, replaced float switch.'),
    ('b0000000-0000-0000-0000-000000000002', 'Bayside Dental', '88 Marine Parade Rd, #02-15',
        now() - interval '20 days', 'completed', '11111111-1111-1111-1111-111111111111',
        'Filter change and coil clean. System within spec.'),

    -- Harbourfront Grocer — single recent job.
    ('c0000000-0000-0000-0000-000000000001', 'Harbourfront Grocer', '5 Quayside Ave',
        now() - interval '10 days', 'completed', '11111111-1111-1111-1111-111111111111',
        'Walk-in cooler fan motor replaced (1/4 HP condenser fan motor).'),

    -- Northgate Offices — a scheduled upcoming job with no history yet.
    ('d0000000-0000-0000-0000-000000000001', 'Northgate Offices', '200 Orchard Blvd, Level 9',
        now() + interval '3 days', 'scheduled', '11111111-1111-1111-1111-111111111111',
        'New customer: thermostat replacement across two zones.')
ON CONFLICT (id) DO NOTHING;
