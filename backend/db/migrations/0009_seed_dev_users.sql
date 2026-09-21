-- 0009_seed_dev_users.sql
--
-- ############################ DEV SEED DATA ############################
-- These two rows exist purely so the stack is usable before real auth lands.
-- Their UUIDs are FIXED and hardcoded so that the dev identity middleware
-- (backend/internal/middleware/devidentity.go, fed by DEV_AUTH_USER_ID) and the
-- frontend can both reference them as constants rather than looking them up.
--
-- password_hash is left at its '' default: these users cannot be logged into.
-- The auth work replaces this file's role with real credentials — once that
-- lands, this migration and the DevIdentity shim can both be removed together.
-- Never ship these rows to a production database.
-- #######################################################################
--
-- Depends on 0001_users.sql.
-- ON CONFLICT (email) DO NOTHING so re-running against a database that already
-- has them is harmless.

INSERT INTO users (id, name, email, role) VALUES
    ('11111111-1111-1111-1111-111111111111', 'Demo Technician', 'tech@reportmate.local',     'technician'),
    ('22222222-2222-2222-2222-222222222222', 'Demo Dispatcher', 'dispatch@reportmate.local', 'dispatcher_admin')
ON CONFLICT (email) DO NOTHING;
