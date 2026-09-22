package agent

import (
	"fmt"
	"strings"

	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// buildSystemPrompt renders the deterministic system message that governs one
// agent run. It describes the agent's job, the manual JSON tool-call contract,
// the six tools and their exact JSON shapes, and embeds the draft's template
// schema (field ids, labels, types, required flags, and options for
// select/checklist) so the model knows exactly which blanks it may fill.
//
// The prompt is built purely from the schema so a given schema always yields
// the same text. It is the system half of the transcript; the runner supplies
// the technician's free-text account as the user message.
func buildSystemPrompt(schema templates.TemplateSchema) string {
	var b strings.Builder

	b.WriteString("You are the Report Mate drafting agent. Your job is to fill in the blanks of a\n")
	b.WriteString("field-service report from the technician's rough, free-text account of a visit.\n\n")

	b.WriteString("Rules:\n")
	b.WriteString("- Fill ONLY the fields defined by the template schema below. Never invent fields.\n")
	b.WriteString("- Do NOT improvise or write content outside the template's structure.\n")
	b.WriteString("- If you cannot confidently fill a REQUIRED field from the account and the\n")
	b.WriteString("  available context, flag it with flag_missing_field instead of guessing.\n")
	b.WriteString("- Photo and signature fields are captured by the human, NOT by you. Never fill\n")
	b.WriteString("  them; if such a field is required, flag it with flag_missing_field.\n")
	b.WriteString("- You may call get_template_schema, get_job_history, and get_parts_catalog to\n")
	b.WriteString("  gather context before filling.\n\n")

	b.WriteString("Response contract:\n")
	b.WriteString("- Reply with ONLY a single JSON object and nothing else — no prose, no\n")
	b.WriteString("  explanation, no code fences. One tool call per reply.\n")
	b.WriteString("- Example: {\"tool\":\"fill_field\",\"field_id\":\"notes\",\"value\":\"Replaced the filter.\"}\n\n")

	b.WriteString("Available tools and their exact JSON shapes:\n")
	b.WriteString("- {\"tool\":\"get_template_schema\"}\n")
	b.WriteString("    Returns the template's sections and fields.\n")
	b.WriteString("- {\"tool\":\"get_job_history\",\"job_id\":\"...\"}\n")
	b.WriteString("    Returns this customer's past jobs (may be empty).\n")
	b.WriteString("- {\"tool\":\"get_parts_catalog\"}\n")
	b.WriteString("    Returns the parts catalog to match mentioned parts (may be empty).\n")
	b.WriteString("- {\"tool\":\"fill_field\",\"field_id\":\"...\",\"value\":<value>}\n")
	b.WriteString("    Writes one field. value is a string for text/select, a number for number,\n")
	b.WriteString("    and an array of strings for checklist (each drawn from the field's options).\n")
	b.WriteString("- {\"tool\":\"flag_missing_field\",\"field_id\":\"...\"}\n")
	b.WriteString("    Marks a required field you cannot confidently fill. Writes no value.\n")
	b.WriteString("- {\"tool\":\"save_draft\"}\n")
	b.WriteString("    Emit this once you have filled everything you can and flagged the rest. It\n")
	b.WriteString("    persists the draft for the technician's review and finishes the run.\n\n")

	b.WriteString("Template schema (these are the only fields you may fill or flag):\n")
	writeSchema(&b, schema)

	b.WriteString("\nWhen you have filled every field you can and flagged the required ones you\n")
	b.WriteString("cannot, emit {\"tool\":\"save_draft\"} to finish.\n")

	return b.String()
}

// writeSchema appends a human-readable, deterministic listing of the schema's
// sections and fields to b, one field per line with its id, label, type,
// required flag, and (for select/checklist) allowed options.
func writeSchema(b *strings.Builder, schema templates.TemplateSchema) {
	if len(schema.Sections) == 0 {
		b.WriteString("(the template defines no sections)\n")
		return
	}

	for _, section := range schema.Sections {
		fmt.Fprintf(b, "Section %q:\n", section.Label)
		if len(section.Fields) == 0 {
			b.WriteString("  (no fields)\n")
			continue
		}
		for _, field := range section.Fields {
			required := "optional"
			if field.Required {
				required = "required"
			}
			fmt.Fprintf(b, "  - id=%q label=%q type=%s (%s)",
				field.ID, field.Label, field.Type, required)
			if field.Type == templates.FieldSelect || field.Type == templates.FieldChecklist {
				fmt.Fprintf(b, " options=[%s]", strings.Join(field.Options, ", "))
			}
			if field.Type == templates.FieldPhoto || field.Type == templates.FieldSignature {
				b.WriteString(" [human-captured: do not fill, flag if required]")
			}
			b.WriteString("\n")
		}
	}
}
