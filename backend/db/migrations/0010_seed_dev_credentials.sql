-- 0010_seed_dev_credentials.sql
--
-- ############################ DEV SEED DATA ############################
-- Gives the two users seeded by 0009_seed_dev_users.sql a real, working
-- password so the login form can actually be used. Their password_hash was
-- left at the '' default by 0009, which means "this account cannot be logged
-- into" (backend/internal/auth/password.go refuses an empty hash outright) —
-- fine while middleware.DevIdentity stamped an identity onto every request,
-- useless now that the shim is gone and the only way in is POST /api/auth/login.
--
--   DEVELOPMENT PASSWORD (both accounts):  reportmate-dev
--
--   tech@reportmate.local     Demo Technician   technician
--   dispatch@reportmate.local Demo Dispatcher   dispatcher_admin
--
-- The password is also documented in .env.example. It is written in plaintext
-- in this comment on purpose: a shared demo credential that nobody can find is
-- a support ticket, and the hashes below are in the same public repository
-- anyway. That is precisely why these rows MUST NEVER reach a production
-- database — anyone reading this file can sign in as a dispatcher-admin.
-- #######################################################################
--
-- The hashes are bcrypt, cost 10, generated with the same
-- auth.HashPassword the server verifies against. They are literals rather
-- than a crypt() call so this migration does not depend on pgcrypto's bcrypt
-- support being compiled in, and so the stored value is byte-identical to what
-- the Go code produces.
--
-- Depends on 0001_users.sql (users table) and 0009_seed_dev_users.sql (the rows).
-- Matched on email, not id, so it is a no-op rather than an error on a database
-- where 0009 was skipped or the rows were seeded by hand.

UPDATE users
SET password_hash = '$2a$10$E1UagFczEnkeq1KllVLM7.BagjvshDCjgy6qk8IHm7pe4w9.xgZNS',
    updated_at    = now()
WHERE email = 'tech@reportmate.local';

UPDATE users
SET password_hash = '$2a$10$XNm1eQEfI6vqO8BZm1FygOQj59yRl67lfa2gnaOsE4fGDI0DObdxO',
    updated_at    = now()
WHERE email = 'dispatch@reportmate.local';
