package templates

// SeedTemplate is a pre-built template shipped at setup time for the demo and
// for teammates to test the renderer and agent against real data (Req 7.1).
// Name is the template name; Schema is its Template Schema, which must satisfy
// the validated contract (Req 7.2) — callers should run Validate over each
// before insert so a broken seed fails setup loudly rather than shipping an
// invalid contract.
type SeedTemplate struct {
	Name   string
	Schema TemplateSchema
}

// SeedTemplates returns the three seed templates shipped at setup time. They
// are authored here in Go as the single source of truth: the accompanying
// migration (backend/db/migrations/0004_seed_report_templates.sql) inserts the
// same three, and the JSON there is kept faithful to these definitions.
//
// Collectively the three templates exercise all six field types
// (text, number, select, checklist, photo, signature) so downstream consumers
// have realistic coverage:
//   - HVAC Service Visit: text, number, select, checklist, photo, signature
//   - General Maintenance Report: text, checklist, photo, signature
//   - Safety Inspection: select, text, checklist, signature
//
// Each returned schema is a valid TemplateSchema per Requirement 1 and passes
// Validate.
func SeedTemplates() []SeedTemplate {
	return []SeedTemplate{
		hvacServiceVisit(),
		generalMaintenanceReport(),
		safetyInspection(),
	}
}

// hvacServiceVisit exercises every one of the six field types across three
// sections: Visit Information (text, number), Diagnostics (select, checklist,
// photo), and Sign-off (signature).
func hvacServiceVisit() SeedTemplate {
	return SeedTemplate{
		Name: "HVAC Service Visit",
		Schema: TemplateSchema{
			Version: 1,
			Sections: []Section{
				{
					ID:    "sec_visit_info",
					Label: "Visit Information",
					Fields: []Field{
						{
							ID:       "fld_arrival_notes",
							Type:     FieldText,
							Label:    "Arrival notes",
							Required: false,
						},
						{
							ID:       "fld_meter_reading",
							Type:     FieldNumber,
							Label:    "Meter reading",
							Required: true,
						},
					},
				},
				{
					ID:    "sec_diagnostics",
					Label: "Diagnostics",
					Fields: []Field{
						{
							ID:       "fld_system_type",
							Type:     FieldSelect,
							Label:    "System type",
							Required: true,
							Options:  []string{"Split", "Packaged", "Ductless"},
						},
						{
							ID:       "fld_safety_checks",
							Type:     FieldChecklist,
							Label:    "Safety checks completed",
							Required: true,
							Options:  []string{"Power isolated", "Refrigerant checked", "Area cleared"},
						},
						{
							ID:       "fld_unit_photo",
							Type:     FieldPhoto,
							Label:    "Unit photo",
							Required: false,
						},
					},
				},
				{
					ID:    "sec_signoff",
					Label: "Sign-off",
					Fields: []Field{
						{
							ID:       "fld_customer_signoff",
							Type:     FieldSignature,
							Label:    "Customer sign-off",
							Required: true,
						},
					},
				},
			},
		},
	}
}

// generalMaintenanceReport spans Job Summary (two text fields), Parts &
// Observations (checklist, photo), and Customer Approval (signature). Parts
// capture here is a plain checklist in the template; the real parts_used table
// is a separate concern (out of scope).
func generalMaintenanceReport() SeedTemplate {
	return SeedTemplate{
		Name: "General Maintenance Report",
		Schema: TemplateSchema{
			Version: 1,
			Sections: []Section{
				{
					ID:    "sec_job_summary",
					Label: "Job Summary",
					Fields: []Field{
						{
							ID:       "fld_work_performed",
							Type:     FieldText,
							Label:    "Work performed",
							Required: true,
						},
						{
							ID:       "fld_followup_notes",
							Type:     FieldText,
							Label:    "Follow-up notes",
							Required: false,
						},
					},
				},
				{
					ID:    "sec_parts_observations",
					Label: "Parts & Observations",
					Fields: []Field{
						{
							ID:       "fld_parts_replaced",
							Type:     FieldChecklist,
							Label:    "Parts replaced",
							Required: false,
							Options:  []string{"Air filter", "Belt", "Capacitor", "Thermostat"},
						},
						{
							ID:       "fld_condition_photo",
							Type:     FieldPhoto,
							Label:    "Equipment condition photo",
							Required: false,
						},
					},
				},
				{
					ID:    "sec_customer_approval",
					Label: "Customer Approval",
					Fields: []Field{
						{
							ID:       "fld_approval_signature",
							Type:     FieldSignature,
							Label:    "Customer approval signature",
							Required: true,
						},
					},
				},
			},
		},
	}
}

// safetyInspection spans Site (select, text), Checks (two checklists), and
// Attestation (signature), emphasizing checklist/signature sign-off.
func safetyInspection() SeedTemplate {
	return SeedTemplate{
		Name: "Safety Inspection",
		Schema: TemplateSchema{
			Version: 1,
			Sections: []Section{
				{
					ID:    "sec_site",
					Label: "Site",
					Fields: []Field{
						{
							ID:       "fld_site_type",
							Type:     FieldSelect,
							Label:    "Site type",
							Required: true,
							Options:  []string{"Residential", "Commercial", "Industrial"},
						},
						{
							ID:       "fld_site_address",
							Type:     FieldText,
							Label:    "Site address",
							Required: true,
						},
					},
				},
				{
					ID:    "sec_checks",
					Label: "Checks",
					Fields: []Field{
						{
							ID:       "fld_ppe_checks",
							Type:     FieldChecklist,
							Label:    "PPE verified",
							Required: true,
							Options:  []string{"Gloves", "Eye protection", "Hard hat", "Hearing protection"},
						},
						{
							ID:       "fld_hazard_checks",
							Type:     FieldChecklist,
							Label:    "Hazards controlled",
							Required: true,
							Options:  []string{"Electrical isolated", "Gas shut off", "Area barricaded"},
						},
					},
				},
				{
					ID:    "sec_attestation",
					Label: "Attestation",
					Fields: []Field{
						{
							ID:       "fld_inspector_signature",
							Type:     FieldSignature,
							Label:    "Inspector attestation signature",
							Required: true,
						},
					},
				},
			},
		},
	}
}
