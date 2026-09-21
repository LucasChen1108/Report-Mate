-- 0001_users.sql
-- Additive migration: creates the users table, the identity root of the schema.
-- jobs, service_reports and report_templates all reference users(id), so this
-- migration must stay first. It also enables the two extensions every later
-- migration assumes: pgcrypto for gen_random_uuid() defaults and citext for
-- case-insensitive email uniqueness.
-- Do not hand-edit once applied; add a new ordered migration instead.

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS citext;

-- password_hash defaults to '' so dev users can be seeded without a hash
-- (see 0009_seed_dev_users.sql). The auth work adds real credentials in a
-- later migration; an empty hash must never be treated as a valid password.
--
-- The role strings are a cross-stack contract: they match dispatcherAdminRole
-- in backend/internal/templates/handler.go and DISPATCHER_ADMIN_ROLE in
-- frontend/src/components/RequireRole.tsx. Changing them breaks RBAC on both
-- sides at once.
CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name          TEXT   NOT NULL CHECK (length(trim(name)) > 0),
    email         CITEXT NOT NULL UNIQUE,
    password_hash TEXT   NOT NULL DEFAULT '',
    role          TEXT   NOT NULL CHECK (role IN ('technician','dispatcher_admin')),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_users_role ON users (role);
