package dashboard

import (
	"bytes"
	"encoding/json"
	"strings"

	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// Display conventions. These four constants are the whole vocabulary a table
// cell speaks; the React table prints cells[fieldId] verbatim and knows none of
// them.
const (
	// missingCell marks a field the report carries no value for at all —
	// typically a column added to the template after the report was filled.
	// It is deliberately different from "", which means "present but empty".
	missingCell = "—"
	// photoCell marks an attachment field that has something in it. It does
	// NOT claim a count: the data was stripped in SQL, so the number of photos
	// is genuinely unknown here and inventing one would be a lie the UI would
	// happily render.
	photoCell = "Photo"
	// signedCell marks a signature field that has been signed.
	signedCell = "Signed"
	// listSeparator joins the values of a multi-value field.
	listSeparator = ", "
)

// flattenColumns turns the template's schema into the table's columns: one per
// field, in section order then field order, each carrying the label of the
// section it came from so the header can group them.
//
// Columns come from the template's CURRENT schema, not from any report's
// schema_snapshot: the table compares reports against the template as it stands
// today, and rows filled against an older revision are flagged rather than
// given columns of their own.
func flattenColumns(schema templates.TemplateSchema) []TableColumn {
	columns := make([]TableColumn, 0)
	for _, section := range schema.Sections {
		for _, field := range section.Fields {
			columns = append(columns, TableColumn{
				FieldID:      field.ID,
				Label:        field.Label,
				Type:         field.Type,
				SectionLabel: section.Label,
			})
		}
	}
	return columns
}

// attachmentFieldIDs lists the field ids whose values must be stripped in SQL:
// every photo and signature field in the schema. Photos and signatures are
// stored as inline base64 data URLs, and they are the only field types that can
// be megabytes wide.
func attachmentFieldIDs(schema templates.TemplateSchema) []string {
	ids := make([]string, 0)
	for _, section := range schema.Sections {
		for _, field := range section.Fields {
			if isAttachmentType(field.Type) {
				ids = append(ids, field.ID)
			}
		}
	}
	return ids
}

// isAttachmentType reports whether a field's value is stripped before it leaves
// the database.
func isAttachmentType(t templates.FieldType) bool {
	return t == templates.FieldPhoto || t == templates.FieldSignature
}

// buildRow assembles one table row: the report's metadata plus a cell for every
// column, already flattened to a display string.
func buildRow(columns []TableColumn, row reportRow, currentRevision int) TableRow {
	cells := make(map[string]string, len(columns))
	for _, column := range columns {
		cells[column.FieldID] = renderCell(column, row)
	}

	return TableRow{
		ReportID:         row.ID,
		CreatedAt:        row.CreatedAt,
		Status:           row.Status,
		TemplateRevision: row.TemplateRevision,
		CustomerName:     row.CustomerName,
		Cells:            cells,
		StaleRevision:    row.TemplateRevision != currentRevision,
	}
}

// renderCell flattens one field of one report to its display string.
//
//	text / number / select   the value as-is
//	checklist                the selected options, comma-joined
//	photo                    "" when empty, else a marker
//	signature                "Signed" when signed, else ""
//	field absent from report  the missing marker
func renderCell(column TableColumn, row reportRow) string {
	if isAttachmentType(column.Type) {
		// The value itself was stripped in SQL, so presence comes from the
		// attachments map. A key absent from it means the report has no such
		// field at all (an older revision), which is a different thing from an
		// unfilled one.
		filled, ok := row.Attachments[column.FieldID]
		switch {
		case !ok:
			return missingCell
		case !filled:
			return ""
		case column.Type == templates.FieldSignature:
			return signedCell
		default:
			return photoCell
		}
	}

	raw, ok := row.Values[column.FieldID]
	if !ok {
		return missingCell
	}
	return displayValue(raw)
}

// displayValue renders a stored JSON value as a display string.
//
// It works off the raw JSON rather than an unmarshaled any on purpose: a number
// keeps the exact text it was stored with ("12", "2.50"), where decoding to
// float64 and reformatting would turn 2.50 into 2.5 and a large id into
// scientific notation.
func displayValue(raw json.RawMessage) string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 {
		return ""
	}

	switch trimmed[0] {
	case 'n': // null — stored, but empty
		return ""
	case 't':
		return "Yes"
	case 'f':
		return "No"
	case '"':
		var s string
		if err := json.Unmarshal(trimmed, &s); err != nil {
			// Unreachable for values that came back out of a jsonb column,
			// which is valid JSON by construction; fall back to the raw text
			// rather than dropping the cell.
			return string(trimmed)
		}
		return s
	case '[':
		return displayList(trimmed)
	case '{':
		// Not a shape any of the six field types stores today (attachment
		// references are stripped before they get here). Render it compactly
		// instead of blanking the cell, so an unexpected value is visible
		// rather than silently invisible.
		return compactJSON(trimmed)
	default: // a number
		return string(trimmed)
	}
}

// displayList renders an array value — a checklist's selections, or any field
// authored with allowMultiple — as a comma-joined list, dropping entries that
// render to nothing so a trailing empty slot does not show up as ", ".
func displayList(raw json.RawMessage) string {
	var items []json.RawMessage
	if err := json.Unmarshal(raw, &items); err != nil {
		return compactJSON(raw)
	}

	parts := make([]string, 0, len(items))
	for _, item := range items {
		if s := displayValue(item); s != "" {
			parts = append(parts, s)
		}
	}
	return strings.Join(parts, listSeparator)
}

// compactJSON strips insignificant whitespace from a JSON value so an
// unexpected shape prints on one line.
func compactJSON(raw json.RawMessage) string {
	var buf bytes.Buffer
	if err := json.Compact(&buf, raw); err != nil {
		return string(raw)
	}
	return buf.String()
}
