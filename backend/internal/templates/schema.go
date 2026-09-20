package templates

// FieldType is the type of a single field within a section. It is one of the
// six supported field types. Only select and checklist carry an options list.
type FieldType string

const (
	FieldText      FieldType = "text"
	FieldNumber    FieldType = "number"
	FieldSelect    FieldType = "select"
	FieldChecklist FieldType = "checklist"
	FieldPhoto     FieldType = "photo"
	FieldSignature FieldType = "signature"
)

// known reports whether t is one of the six supported field types.
func (t FieldType) known() bool {
	switch t {
	case FieldText, FieldNumber, FieldSelect, FieldChecklist, FieldPhoto, FieldSignature:
		return true
	}
	return false
}

// carriesOptions reports whether t is a field type that carries an options list.
func (t FieldType) carriesOptions() bool {
	return t == FieldSelect || t == FieldChecklist
}

// Field is a single typed input within a section. Options is present only for
// select and checklist fields.
type Field struct {
	ID            string    `json:"id"`
	Type          FieldType `json:"type"`
	Label         string    `json:"label"`
	Required      bool      `json:"required"`
	AllowMultiple bool      `json:"allowMultiple,omitempty"` // multi-value at fill time
	Options       []string  `json:"options,omitempty"`       // only for select/checklist
}

// Section is a named, ordered grouping of fields within a template schema.
type Section struct {
	ID     string  `json:"id"`
	Label  string  `json:"label"`
	Fields []Field `json:"fields"`
}

// TemplateSchema is the single shared contract: an ordered list of sections,
// each containing an ordered list of typed fields. It is persisted as JSON in
// report_templates.schema.
type TemplateSchema struct {
	Version  int       `json:"version"`
	Sections []Section `json:"sections"`
}
