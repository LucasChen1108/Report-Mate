-- 0011_parts_catalog.sql
-- Additive migration: creates parts_catalog, the reference list of real parts
-- the AI agent matches a technician's free-text mentions against
-- (internal/agent get_parts_catalog via PartsCatalogProvider).
--
-- This is DISTINCT from parts_used (0007): parts_used records the parts a
-- technician actually consumed on ONE report; parts_catalog is the shared
-- master list of parts that exist to be chosen from. The agent reads the
-- catalog to turn "swapped the run cap" into the real catalogued part + number.
--
-- Do not hand-edit once applied; add a new ordered migration instead.

CREATE TABLE parts_catalog (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    part        TEXT NOT NULL,
    -- part_number is the manufacturer/stock number; unique so a catalog import
    -- cannot silently duplicate an entry. Empty is disallowed: a catalog row
    -- with no number is not useful for matching.
    part_number TEXT NOT NULL CHECK (length(trim(part_number)) > 0),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (part_number)
);

-- The agent's matching is case-insensitive over the part name, mirroring the
-- lower(part) index parts_used already uses for the same reason.
CREATE INDEX idx_parts_catalog_part ON parts_catalog (lower(part));

-- ############################ DEV/DEMO SEED DATA ############################
-- A small, realistic HVAC/field-service parts catalog so the agent's
-- get_parts_catalog tool returns useful matches in the demo. These are ordinary
-- reference data (not secrets) and are safe to ship. Matched on part_number via
-- ON CONFLICT so re-running is a no-op.
INSERT INTO parts_catalog (part, part_number) VALUES
    ('Run capacitor 45/5 MFD 370V',        'CAP-455-370'),
    ('Run capacitor 35/5 MFD 440V',        'CAP-355-440'),
    ('Dual run capacitor 40/5 MFD 440V',   'CAP-405-440'),
    ('Contactor 2-pole 30A 24V coil',      'CON-2P-30A'),
    ('Contactor 1-pole 40A 24V coil',      'CON-1P-40A'),
    ('Air filter 16x25x1 MERV 8',          'AF-162501-M8'),
    ('Air filter 20x25x1 MERV 11',         'AF-202501-M11'),
    ('Fan blower motor 1/3 HP 115V',       'MOT-BLW-13HP'),
    ('Condenser fan motor 1/4 HP 208V',    'MOT-CFM-14HP'),
    ('Thermostat programmable 24V',        'TSTAT-PROG-24'),
    ('Refrigerant R-410A (per lb)',        'REF-410A-LB'),
    ('Compressor start kit (hard start)',  'CSK-HARD-START'),
    ('Fan belt A-section 4L360',           'BELT-4L360'),
    ('Igniter hot surface 120V',           'IGN-HSI-120'),
    ('Flame sensor rod',                   'SENS-FLAME-01'),
    ('Drain pan float switch',             'SW-FLOAT-DP'),
    ('Condensate pump 120V',               'PUMP-COND-120'),
    ('TXV valve R-410A 3-ton',             'TXV-410-3T'),
    ('Capacitor terminal boot kit',        'KIT-CAP-BOOT'),
    ('Line set 3/8 x 3/4 (per ft)',        'LINE-3834-FT')
ON CONFLICT (part_number) DO NOTHING;
