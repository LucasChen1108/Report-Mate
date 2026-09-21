package reports

import (
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"

	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// ValidationError identifies the offending element when report content fails
// validation.
//
// It intentionally mirrors templates.ValidationError field for field (Field /
// Element / Message) rather than importing it: the handler maps both to the
// same 422 body, so the frontend's existing 422 handling — the message plus the
// `elementId` it highlights — works on a content failure with no change. A
// separate type keeps the two error strings honest ("report content" vs
// "template") and stops content rules and schema rules from drifting into one
// another's package.
//
// Field is the category of rule that was violated
// ("unknown" | "type" | "required" | "structure"); Element is the offending
// field id, part row id, or content key (empty when the failure names nothing);
// Message is a human-readable explanation.
type ValidationError struct {
	Field   string // "unknown" | "type" | "required" | "structure"
	Element string // offending field id / part row id, empty if structural
	Message string
}

// Error implements the error interface.
func (e *ValidationError) Error() string {
	if e.Element == "" {
		return fmt.Sprintf("report content validation failed (%s): %s", e.Field, e.Message)
	}
	return fmt.Sprintf("report content validation failed (%s) at %q: %s", e.Field, e.Element, e.Message)
}

// ValidateContent checks report content against the schema it was filled
// against. It is a pure function: it returns nil when the content is valid, or
// the first *ValidationError it finds, and never mutates or persists anything.
//
// requireComplete SELECTS THE CALLER'S INTENT AND IS NOT A STRICTNESS DIAL:
//
//	false — a draft save (POST /api/reports, PUT /api/reports/{id}). Structure
//	        and types are enforced; emptiness is not. Autosaving a half-filled
//	        report MUST succeed, or the renderer becomes unusable the moment a
//	        technician pauses mid-form.
//	true  — submit / export (POST /api/reports/{id}/save-and-export). Every
//	        required field must carry a value, because this is the point the
//	        report becomes a document someone signs off on.
//
// Three rules are enforced, in this order:
//
//  1. UNKNOWN KEYS. Every key in Values must be a field id declared by the
//     schema. THIS IS A SECURITY BOUNDARY, not a tidiness rule: it is the
//     enforcement point for the product guarantee that "the agent can only
//     write into fields defined by the active template's schema"
//     (.kiro/steering/tech.md). The agent's fill_field tool writes through this
//     function. Do not relax it — an unrecognized key is a rejected write, not
//     an ignored one.
//
//  2. TYPE MATCH. Each value must match the shape its field's declared type
//     implies (see validateValue).
//
//  3. REQUIRED FIELDS, only when requireComplete is true.
//
// The schema passed in is the report's schema_snapshot — the template as it
// was at fill time — never the template's current schema. Validating against a
// since-edited template would reject content that was correct when it was
// written.
func ValidateContent(schema templates.TemplateSchema, content ReportContent, requireComplete bool) error {
	if content.FilledBy != "" && !knownFilledBy(content.FilledBy) {
		return &ValidationError{
			Field:   "structure",
			Element: "",
			Message: fmt.Sprintf("filledBy must be one of %q, %q or %q", FilledByManual, FilledByAgent, FilledByMixed),
		}
	}

	fields := indexFields(schema)

	// Rule 1: unknown keys (the security boundary).
	if err := validateKnownKeys(fields, content.Values); err != nil {
		return err
	}

	// Rules 2 and 3, walked in schema order so the error reported for a
	// content object with several problems is stable and predictable rather
	// than whichever key Go's map iteration happened to reach first.
	for _, section := range schema.Sections {
		for _, field := range section.Fields {
			raw, present := content.Values[field.ID]

			if present && !isJSONNull(raw) {
				if err := validateValue(field, raw); err != nil {
					return err
				}
			}

			if !requireComplete || !field.Required {
				continue
			}
			if !present || isEmptyValue(field, raw) {
				return &ValidationError{
					Field:   "required",
					Element: field.ID,
					Message: fmt.Sprintf("%q is required and has not been filled in", field.Label),
				}
			}
		}
	}

	// Returned through an explicit nil rather than as the *ValidationError the
	// helper declares: a typed nil pointer in an error interface is non-nil,
	// which would make every valid report look invalid.
	if err := validateParts(content.Parts); err != nil {
		return err
	}
	return nil
}

// indexFields flattens the schema's sections into a field-id lookup. Field ids
// are unique across a whole template (templates.Validate enforces it), so a
// flat index is safe.
func indexFields(schema templates.TemplateSchema) map[string]templates.Field {
	fields := make(map[string]templates.Field)
	for _, section := range schema.Sections {
		for _, field := range section.Fields {
			fields[field.ID] = field
		}
	}
	return fields
}

// validateKnownKeys enforces rule 1: every key in values names a field the
// schema declares. Unknown keys are sorted before the first is reported, so a
// caller that sends several gets the same deterministic answer every time
// instead of a different key per request.
func validateKnownKeys(fields map[string]templates.Field, values map[string]json.RawMessage) *ValidationError {
	unknown := make([]string, 0)
	for key := range values {
		if _, ok := fields[key]; !ok {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) == 0 {
		return nil
	}
	sort.Strings(unknown)
	return &ValidationError{
		Field:   "unknown",
		Element: unknown[0],
		Message: fmt.Sprintf("%q is not a field in this report's template schema", unknown[0]),
	}
}

// validateValue enforces rule 2 for one field. raw is known to be present and
// non-null; a null is handled by the caller as "nothing filled in", which is
// legal for every type except where rule 3 demands a value.
//
// Photo values are NOT size-checked. Photos and signatures are currently inline
// base64 data URLs, which makes a legitimate value megabytes long; that is a
// known, accepted tradeoff for this build (see maxReportBodyBytes in
// cmd/server) and rejecting a large value here would reject a real report.
func validateValue(field templates.Field, raw json.RawMessage) *ValidationError {
	switch field.Type {
	case templates.FieldText:
		if _, ok := decodeString(raw); !ok {
			return typeError(field, "a string")
		}

	case templates.FieldNumber:
		value, ok := decodeString(raw)
		if !ok {
			return typeError(field, "a string")
		}
		// Kept as a string on the wire so a half-typed entry round-trips, but
		// it still has to be a number when it is not empty.
		if trimmed := strings.TrimSpace(value); trimmed != "" {
			if _, err := strconv.ParseFloat(trimmed, 64); err != nil {
				return &ValidationError{
					Field:   "type",
					Element: field.ID,
					Message: fmt.Sprintf("%q must be a number, got %q", field.Label, value),
				}
			}
		}

	case templates.FieldSelect:
		value, ok := decodeString(raw)
		if !ok {
			return typeError(field, "a string")
		}
		if value != "" && !containsOption(field.Options, value) {
			return &ValidationError{
				Field:   "type",
				Element: field.ID,
				Message: fmt.Sprintf("%q is not one of the options offered for %q", value, field.Label),
			}
		}

	case templates.FieldChecklist:
		values, ok := decodeStringSlice(raw)
		if !ok {
			return typeError(field, "an array of strings")
		}
		for _, value := range values {
			if !containsOption(field.Options, value) {
				return &ValidationError{
					Field:   "type",
					Element: field.ID,
					Message: fmt.Sprintf("%q is not one of the options offered for %q", value, field.Label),
				}
			}
		}

	case templates.FieldPhoto:
		return validatePhotoValue(field, raw)

	case templates.FieldSignature:
		// A signature is a data-URL string, or null for unsigned. Null is
		// filtered out before this point, so only the string form is left.
		if _, ok := decodeString(raw); !ok {
			return typeError(field, "a string or null")
		}

	default:
		// Unreachable for a schema that passed templates.Validate, which
		// rejects unknown field types. Reported rather than ignored so a
		// schema that somehow carries one does not silently accept anything.
		return &ValidationError{
			Field:   "type",
			Element: field.ID,
			Message: fmt.Sprintf("field has unrecognized type %q", string(field.Type)),
		}
	}

	return nil
}

// photoKeys are the only keys a photo value may carry, mirroring PhotoValue in
// reportContent.ts. dataUrl and caption are required; fileName is optional.
var photoKeys = map[string]bool{"dataUrl": true, "caption": true, "fileName": true}

// validatePhotoValue enforces the photo object shape:
// {dataUrl: string|null, caption: string, fileName?: string}. Unknown keys are
// rejected for the same reason unknown field ids are — a writer that does not
// know the shape should be told so, not have half its value silently dropped.
func validatePhotoValue(field templates.Field, raw json.RawMessage) *ValidationError {
	var object map[string]json.RawMessage
	if err := json.Unmarshal(raw, &object); err != nil {
		return typeError(field, "an object with dataUrl and caption")
	}

	for key := range object {
		if !photoKeys[key] {
			return &ValidationError{
				Field:   "type",
				Element: field.ID,
				Message: fmt.Sprintf("photo value for %q carries unrecognized key %q", field.Label, key),
			}
		}
	}

	dataURL, present := object["dataUrl"]
	if !present {
		return typeError(field, "an object with a dataUrl key")
	}
	if !isJSONNull(dataURL) {
		if _, ok := decodeString(dataURL); !ok {
			return typeError(field, "a dataUrl that is a string or null")
		}
	}

	caption, present := object["caption"]
	if !present {
		return typeError(field, "an object with a caption key")
	}
	if _, ok := decodeString(caption); !ok {
		return typeError(field, "a caption that is a string")
	}

	if fileName, present := object["fileName"]; present && !isJSONNull(fileName) {
		if _, ok := decodeString(fileName); !ok {
			return typeError(field, "a fileName that is a string")
		}
	}

	return nil
}

// isEmptyValue reports whether a field's value counts as "not filled in" for
// rule 3. It is only called on a value that has already passed validateValue,
// so a decode failure here means the value was null — which is empty for every
// type.
//
// Empty per type: "" for text/number/select, [] for checklist, a null dataUrl
// for photo, and null (or "") for signature.
func isEmptyValue(field templates.Field, raw json.RawMessage) bool {
	if isJSONNull(raw) {
		return true
	}

	switch field.Type {
	case templates.FieldChecklist:
		values, ok := decodeStringSlice(raw)
		return !ok || len(values) == 0

	case templates.FieldPhoto:
		var photo photoValue
		if err := json.Unmarshal(raw, &photo); err != nil {
			return true
		}
		return photo.DataURL == nil || strings.TrimSpace(*photo.DataURL) == ""

	default:
		// text, number, select, signature: an empty (or whitespace-only)
		// string is nothing filled in.
		value, ok := decodeString(raw)
		return !ok || strings.TrimSpace(value) == ""
	}
}

// validateParts checks the Parts Used table. Quantity is a string on the wire
// and a NUMERIC in the database, so the one thing that must hold is that a
// non-empty quantity actually parses — "" is a legal mid-edit state and becomes
// 0, but "abc" is a wrong number that would otherwise be silently zeroed into
// an invoice.
//
// This runs in both modes: a quantity that cannot be stored is a bad write
// whether or not the report is complete.
func validateParts(parts []PartRow) *ValidationError {
	for i, part := range parts {
		if strings.TrimSpace(part.Quantity) == "" {
			continue
		}
		if _, err := strconv.ParseFloat(strings.TrimSpace(part.Quantity), 64); err != nil {
			return &ValidationError{
				Field:   "type",
				Element: partElement(part, i),
				Message: fmt.Sprintf("parts used quantity must be a number, got %q", part.Quantity),
			}
		}
	}
	return nil
}

// partElement names a parts row for a validation error: its client-side row id
// when it has one (which is what the renderer keys the row on and can
// highlight), otherwise its position in the table.
func partElement(part PartRow, index int) string {
	if strings.TrimSpace(part.ID) != "" {
		return part.ID
	}
	return fmt.Sprintf("parts[%d]", index)
}

// typeError builds the standard type-mismatch error, naming the field by its
// human label and saying what shape was expected.
func typeError(field templates.Field, expected string) *ValidationError {
	return &ValidationError{
		Field:   "type",
		Element: field.ID,
		Message: fmt.Sprintf("%q must be %s", field.Label, expected),
	}
}

// containsOption reports whether value is one of the field's declared options.
func containsOption(options []string, value string) bool {
	for _, option := range options {
		if option == value {
			return true
		}
	}
	return false
}
