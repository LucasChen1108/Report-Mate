-- 0012_stage_b_accounts.sql
--
-- Expands the legacy one-email users table into the Stage B account model and
-- adds authorization-code and opaque-session persistence. This migration is
-- forward-only: the legacy name/email columns remain so existing report and
-- authentication code can be migrated in later commits without a flag day.

CREATE TABLE companies (
    id              UUID PRIMARY KEY,
    name            TEXT NOT NULL CHECK (length(trim(name)) > 0),
    normalized_name TEXT NOT NULL UNIQUE
                    CHECK (normalized_name = lower(trim(normalized_name))
                           AND length(normalized_name) > 0),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE users
    ADD COLUMN company_id       UUID REFERENCES companies(id) ON DELETE RESTRICT,
    ADD COLUMN phone            TEXT NOT NULL DEFAULT '',
    ADD COLUMN manager_admin_id UUID,
    ADD COLUMN is_active        BOOLEAN NOT NULL DEFAULT true;

-- Existing rows predate companies. Map them to one explicit quarantine company
-- rather than guessing their real organization or dropping historical owners.
-- Fresh production databases with no legacy rows do not receive this company.
INSERT INTO companies (id, name, normalized_name)
SELECT '00000000-0000-0000-0000-000000000001',
       'Legacy imported accounts',
       'legacy imported accounts'
WHERE EXISTS (SELECT 1 FROM users)
ON CONFLICT (id) DO NOTHING;

UPDATE users
SET company_id = '00000000-0000-0000-0000-000000000001'
WHERE company_id IS NULL;

ALTER TABLE users
    ALTER COLUMN company_id SET NOT NULL,
    ADD CONSTRAINT users_not_own_manager
        CHECK (manager_admin_id IS NULL OR manager_admin_id <> id),
    ADD CONSTRAINT users_admin_has_no_manager
        CHECK (role <> 'dispatcher_admin' OR manager_admin_id IS NULL),
    ADD CONSTRAINT users_id_company_unique UNIQUE (id, company_id),
    ADD CONSTRAINT users_manager_same_company_fk
        FOREIGN KEY (manager_admin_id, company_id)
        REFERENCES users (id, company_id)
        ON DELETE RESTRICT;

CREATE INDEX idx_users_company_role
    ON users (company_id, role);
CREATE INDEX idx_users_manager_active
    ON users (manager_admin_id, is_active)
    WHERE manager_admin_id IS NOT NULL;

-- This table is the authoritative login identity index. One normalized address
-- can appear only once globally, irrespective of whether it is someone's
-- personal email or company email. This closes the cross-column uniqueness gap
-- that two separate unique indexes cannot close.
CREATE TABLE user_login_emails (
    normalized_email TEXT PRIMARY KEY
                      CHECK (normalized_email = lower(trim(normalized_email))
                             AND length(normalized_email) > 0),
    user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    email_kind       TEXT NOT NULL CHECK (email_kind IN ('personal','company')),
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, email_kind)
);

-- Preserve login for historical rows while marking the only known address as
-- company email. Their published passwords were already invalidated by 0011.
INSERT INTO user_login_emails (normalized_email, user_id, email_kind)
SELECT lower(trim(email::text)), id, 'company'
FROM users
ON CONFLICT (normalized_email) DO NOTHING;

CREATE INDEX idx_user_login_emails_user
    ON user_login_emails (user_id);

CREATE TABLE company_admin_codes (
    id          UUID PRIMARY KEY,
    company_id  UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    code_hash   BYTEA NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
    max_uses    INTEGER NOT NULL DEFAULT 1 CHECK (max_uses > 0),
    used_count  INTEGER NOT NULL DEFAULT 0
                CHECK (used_count >= 0 AND used_count <= max_uses),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_company_admin_codes_company
    ON company_admin_codes (company_id, created_at DESC);
CREATE INDEX idx_company_admin_codes_available
    ON company_admin_codes (expires_at)
    WHERE revoked_at IS NULL;

CREATE TABLE worker_join_codes (
    id               UUID PRIMARY KEY,
    company_id       UUID NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    manager_admin_id UUID NOT NULL,
    code_hash        BYTEA NOT NULL UNIQUE CHECK (octet_length(code_hash) = 32),
    expires_at       TIMESTAMPTZ NOT NULL,
    revoked_at       TIMESTAMPTZ,
    redeemed_by      UUID,
    redeemed_at      TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT worker_join_codes_manager_same_company_fk
        FOREIGN KEY (manager_admin_id, company_id)
        REFERENCES users (id, company_id)
        ON DELETE RESTRICT,
    CONSTRAINT worker_join_codes_redeemer_same_company_fk
        FOREIGN KEY (redeemed_by, company_id)
        REFERENCES users (id, company_id)
        ON DELETE RESTRICT,
    CONSTRAINT worker_join_codes_redemption_pair
        CHECK ((redeemed_by IS NULL) = (redeemed_at IS NULL))
);

CREATE INDEX idx_worker_join_codes_manager
    ON worker_join_codes (manager_admin_id, created_at DESC);
CREATE INDEX idx_worker_join_codes_available
    ON worker_join_codes (company_id, expires_at)
    WHERE revoked_at IS NULL AND redeemed_at IS NULL;

CREATE TABLE sessions (
    id          UUID PRIMARY KEY,
    user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  BYTEA NOT NULL UNIQUE CHECK (octet_length(token_hash) = 32),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_user_active
    ON sessions (user_id, expires_at)
    WHERE revoked_at IS NULL;
CREATE INDEX idx_sessions_expiry
    ON sessions (expires_at);
