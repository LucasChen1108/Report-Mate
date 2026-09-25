-- 0011_disable_legacy_dev_credentials.sql
--
-- 0009 and 0010 were historically part of the unconditional migration stream
-- and may already exist in a shared database. They installed two public demo
-- identities with a documented password. New installations omit those seed
-- files, while this forward-only migration makes the known credentials
-- unusable in databases that already applied them.
--
-- Match both the fixed development UUID and email so an unrelated account that
-- later adopts one value is not modified. The rows remain because reports and
-- jobs may already reference them. Development credentials can be restored
-- explicitly with `go run ./cmd/devseed` outside production.

UPDATE users
SET password_hash = '',
    updated_at = now()
WHERE (id = '11111111-1111-1111-1111-111111111111'
       AND email = 'tech@reportmate.local')
   OR (id = '22222222-2222-2222-2222-222222222222'
       AND email = 'dispatch@reportmate.local');
