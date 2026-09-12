-- 0004_seed_report_templates.sql
-- Additive migration: inserts the seed report templates for the Template Builder
-- demo and for teammates to test the renderer and agent against (Req 7.1, 7.2, 7.3).
-- Each schema mirrors backend/internal/templates/seeds.go (the source of truth),
-- which runs every seed through Validate so a broken seed fails setup loudly.
-- The three templates collectively exercise all six field types
-- (text, number, select, checklist, photo, signature).
-- Do not hand-edit once applied; add a new ordered migration instead.

INSERT INTO report_templates (name, schema, is_seed) VALUES
(
    'HVAC Service Visit',
    '{
        "version": 1,
        "sections": [
            {
                "id": "sec_visit_info",
                "label": "Visit Information",
                "fields": [
                    { "id": "fld_arrival_notes", "type": "text", "label": "Arrival notes", "required": false },
                    { "id": "fld_meter_reading", "type": "number", "label": "Meter reading", "required": true }
                ]
            },
            {
                "id": "sec_diagnostics",
                "label": "Diagnostics",
                "fields": [
                    { "id": "fld_system_type", "type": "select", "label": "System type", "required": true, "options": ["Split", "Packaged", "Ductless"] },
                    { "id": "fld_safety_checks", "type": "checklist", "label": "Safety checks completed", "required": true, "options": ["Power isolated", "Refrigerant checked", "Area cleared"] },
                    { "id": "fld_unit_photo", "type": "photo", "label": "Unit photo", "required": false }
                ]
            },
            {
                "id": "sec_signoff",
                "label": "Sign-off",
                "fields": [
                    { "id": "fld_customer_signoff", "type": "signature", "label": "Customer sign-off", "required": true }
                ]
            }
        ]
    }'::jsonb,
    TRUE
),
(
    'General Maintenance Report',
    '{
        "version": 1,
        "sections": [
            {
                "id": "sec_job_summary",
                "label": "Job Summary",
                "fields": [
                    { "id": "fld_work_performed", "type": "text", "label": "Work performed", "required": true },
                    { "id": "fld_followup_notes", "type": "text", "label": "Follow-up notes", "required": false }
                ]
            },
            {
                "id": "sec_parts_observations",
                "label": "Parts & Observations",
                "fields": [
                    { "id": "fld_parts_replaced", "type": "checklist", "label": "Parts replaced", "required": false, "options": ["Air filter", "Belt", "Capacitor", "Thermostat"] },
                    { "id": "fld_condition_photo", "type": "photo", "label": "Equipment condition photo", "required": false }
                ]
            },
            {
                "id": "sec_customer_approval",
                "label": "Customer Approval",
                "fields": [
                    { "id": "fld_approval_signature", "type": "signature", "label": "Customer approval signature", "required": true }
                ]
            }
        ]
    }'::jsonb,
    TRUE
),
(
    'Safety Inspection',
    '{
        "version": 1,
        "sections": [
            {
                "id": "sec_site",
                "label": "Site",
                "fields": [
                    { "id": "fld_site_type", "type": "select", "label": "Site type", "required": true, "options": ["Residential", "Commercial", "Industrial"] },
                    { "id": "fld_site_address", "type": "text", "label": "Site address", "required": true }
                ]
            },
            {
                "id": "sec_checks",
                "label": "Checks",
                "fields": [
                    { "id": "fld_ppe_checks", "type": "checklist", "label": "PPE verified", "required": true, "options": ["Gloves", "Eye protection", "Hard hat", "Hearing protection"] },
                    { "id": "fld_hazard_checks", "type": "checklist", "label": "Hazards controlled", "required": true, "options": ["Electrical isolated", "Gas shut off", "Area barricaded"] }
                ]
            },
            {
                "id": "sec_attestation",
                "label": "Attestation",
                "fields": [
                    { "id": "fld_inspector_signature", "type": "signature", "label": "Inspector attestation signature", "required": true }
                ]
            }
        ]
    }'::jsonb,
    TRUE
);
