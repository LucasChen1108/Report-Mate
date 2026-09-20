package templates

import (
	"fmt"
	"strings"
)

// Validation bounds for the Template Schema contract (Requirement 1).
const (
	minSections = 1
	maxSections = 50
	minFields   = 0
	maxFields   = 100
	maxIDLen    = 64
	maxLabelLen = 120
	minOptions  = 1
	maxOptions  = 50
)

// ValidationError identifies the offending element when a schema fails
// validation. Field is the category of rule that was violated
// ("type" | "label" | "options" | "identifier" | "structure"); Element is the
// offending field or section identifier (empty for structural errors such as
// the section-count bound); Message is a human-readable explanation.
type ValidationError struct {
	Field   string // "type" | "label" | "options" | "identifier" | "structure"
	Element string // offending field/section identifier, empty if structural
	Message string
}

// Error implements the error interface.
func (e *ValidationError) Error() string {
	if e.Element == "" {
		return fmt.Sprintf("template validation failed (%s): %s", e.Field, e.Message)
	}
	return fmt.Sprintf("template validation failed (%s) at %q: %s", e.Field, e.Element, e.Message)
}

// Validate checks a TemplateSchema against every Requirement 1 rule. It is a
// pure function over the schema: it returns nil when the schema is valid, or
// the first *ValidationError it finds (naming the offending element by id, or
// using a structural marker for the section-count case). It never mutates the
// schema and never persists any state.
func Validate(schema TemplateSchema) error {
	// Section count: 1..50 (Req 1.1, 1.11). Structural — no element id.
	if len(schema.Sections) < minSections {
		return &ValidationError{
			Field:   "structure",
			Element: "",
			Message: fmt.Sprintf("template must contain at least %d section", minSections),
		}
	}
	if len(schema.Sections) > maxSections {
		return &ValidationError{
			Field:   "structure",
			Element: "",
			Message: fmt.Sprintf("template must contain at most %d sections, got %d", maxSections, len(schema.Sections)),
		}
	}

	seenFieldIDs := make(map[string]struct{})

	for _, section := range schema.Sections {
		// Section label: non-empty (trimmed), 1..120 chars (Req 1.5, 1.11, 1.12).
		if err := validateLabel(section.Label, section.ID); err != nil {
			return err
		}

		// Field count per section: 0..100 (Req 1.1, 1.11).
		if len(section.Fields) < minFields || len(section.Fields) > maxFields {
			return &ValidationError{
				Field:   "structure",
				Element: section.ID,
				Message: fmt.Sprintf("section must contain between %d and %d fields, got %d", minFields, maxFields, len(section.Fields)),
			}
		}

		for _, field := range section.Fields {
			// Field id: non-empty, 1..64 chars (Req 1.4, 1.11).
			if len(field.ID) < 1 || len(field.ID) > maxIDLen {
				return &ValidationError{
					Field:   "identifier",
					Element: field.ID,
					Message: fmt.Sprintf("field identifier must be a non-empty string of 1 to %d characters", maxIDLen),
				}
			}

			// Field id: unique across the whole template (Req 1.4, 1.7).
			if _, exists := seenFieldIDs[field.ID]; exists {
				return &ValidationError{
					Field:   "identifier",
					Element: field.ID,
					Message: "field identifier must be unique within the template",
				}
			}
			seenFieldIDs[field.ID] = struct{}{}

			// Known field type (Req 1.2, 1.7, 1.8).
			if !field.Type.known() {
				return &ValidationError{
					Field:   "type",
					Element: field.ID,
					Message: fmt.Sprintf("field has unrecognized type %q", string(field.Type)),
				}
			}

			// Field label: non-empty (trimmed), 1..120 chars (Req 1.5, 1.11, 1.12).
			if err := validateLabel(field.Label, field.ID); err != nil {
				return err
			}

			// Option rules (Req 1.6, 1.9, 1.13).
			if err := validateOptions(field); err != nil {
				return err
			}
		}
	}

	return nil
}

// validateLabel enforces the shared label rule: after trimming surrounding
// whitespace the label must be a non-empty string of 1 to 120 characters
// (Req 1.5, 1.11, 1.12). element names the offending section or field.
func validateLabel(label, element string) *ValidationError {
	trimmed := strings.TrimSpace(label)
	if trimmed == "" {
		return &ValidationError{
			Field:   "label",
			Element: element,
			Message: "label must be a non-empty string",
		}
	}
	if len(label) > maxLabelLen {
		return &ValidationError{
			Field:   "label",
			Element: element,
			Message: fmt.Sprintf("label must be at most %d characters", maxLabelLen),
		}
	}
	return nil
}

// validateOptions enforces the option-list rules (Req 1.6, 1.9, 1.13):
//   - select/checklist fields must carry 1..50 options with values unique
//     within the field;
//   - non-option types (text/number/photo/signature) must carry no options.
func validateOptions(field Field) *ValidationError {
	if !field.Type.carriesOptions() {
		if len(field.Options) > 0 {
			return &ValidationError{
				Field:   "options",
				Element: field.ID,
				Message: fmt.Sprintf("field of type %q must not carry options", string(field.Type)),
			}
		}
		return nil
	}

	// select/checklist: 1..50 options.
	if len(field.Options) < minOptions {
		return &ValidationError{
			Field:   "options",
			Element: field.ID,
			Message: fmt.Sprintf("field of type %q must have at least %d option", string(field.Type), minOptions),
		}
	}
	if len(field.Options) > maxOptions {
		return &ValidationError{
			Field:   "options",
			Element: field.ID,
			Message: fmt.Sprintf("field of type %q must have at most %d options, got %d", string(field.Type), maxOptions, len(field.Options)),
		}
	}

	// Option values unique within the field.
	seen := make(map[string]struct{}, len(field.Options))
	for _, opt := range field.Options {
		if _, exists := seen[opt]; exists {
			return &ValidationError{
				Field:   "options",
				Element: field.ID,
				Message: fmt.Sprintf("field options must be unique within the field; duplicate value %q", opt),
			}
		}
		seen[opt] = struct{}{}
	}

	return nil
}
