package reports

import (
	"encoding/json"
	"errors"
	"testing"

	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// testSchema is the schema every case here validates against: one field of
// each of the six types in an optional flavor, and one of each in a required
// flavor, so a single schema exercises both the type rules and the required
// rules without each test building its own.
func testSchema() templates.TemplateSchema {
	return templates.TemplateSchema{
		Version: 1,
		Sections: []templates.Section{
			{
				ID:    "sec_optional",
				Label: "Optional",
				Fields: []templates.Field{
					{ID: "fld_text", Type: templates.FieldText, Label: "Notes"},
					{ID: "fld_number", Type: templates.FieldNumber, Label: "Meter reading"},
					{ID: "fld_select", Type: templates.FieldSelect, Label: "System type",
						Options: []string{"Split", "Packaged"}},
					{ID: "fld_checklist", Type: templates.FieldChecklist, Label: "Safety checks",
						Options: []string{"Power isolated", "Area cleared"}},
					{ID: "fld_photo", Type: templates.FieldPhoto, Label: "Unit photo"},
					{ID: "fld_signature", Type: templates.FieldSignature, Label: "Customer sign-off"},
				},
			},
			{
				ID:    "sec_required",
				Label: "Required",
				Fields: []templates.Field{
					{ID: "req_text", Type: templates.FieldText, Label: "Work performed", Required: true},
					{ID: "req_number", Type: templates.FieldNumber, Label: "Hours", Required: true},
					{ID: "req_select", Type: templates.FieldSelect, Label: "Site type", Required: true,
						Options: []string{"Residential", "Commercial"}},
					{ID: "req_checklist", Type: templates.FieldChecklist, Label: "PPE verified", Required: true,
						Options: []string{"Gloves", "Hard hat"}},
					{ID: "req_photo", Type: templates.FieldPhoto, Label: "Condition photo", Required: true},
					{ID: "req_signature", Type: templates.FieldSignature, Label: "Inspector signature", Required: true},
				},
			},
		},
	}
}

// completeValues is a content map that satisfies every required field, so a
// required-field case only has to override the one field under test.
func completeValues() map[string]json.RawMessage {
	return map[string]json.RawMessage{
		"req_text":      raw(`"Replaced the capacitor"`),
		"req_number":    raw(`"2.5"`),
		"req_select":    raw(`"Residential"`),
		"req_checklist": raw(`["Gloves"]`),
		"req_photo":     raw(`{"dataUrl":"data:image/png;base64,iVBORw0KGgo=","caption":"After"}`),
		"req_signature": raw(`"data:image/png;base64,iVBORw0KGgo="`),
	}
}

func raw(s string) json.RawMessage { return json.RawMessage(s) }

// contentWith builds report content from a values map, leaving parts empty.
func contentWith(values map[string]json.RawMessage) ReportContent {
	return ReportContent{Values: values, FilledBy: FilledByManual}
}

// assertValidation checks the outcome of a ValidateContent call against the
// expected rule category and offending element. wantField == "" means the call
// was expected to succeed.
func assertValidation(t *testing.T, err error, wantField, wantElement string) {
	t.Helper()

	if wantField == "" {
		if err != nil {
			t.Fatalf("expected valid content, got error: %v", err)
		}
		return
	}

	if err == nil {
		t.Fatalf("expected a %s validation error naming %q, got nil", wantField, wantElement)
	}
	var verr *ValidationError
	if !errors.As(err, &verr) {
		t.Fatalf("expected *ValidationError, got %T: %v", err, err)
	}
	if verr.Field != wantField {
		t.Errorf("error category = %q, want %q (message: %s)", verr.Field, wantField, verr.Message)
	}
	if verr.Element != wantElement {
		t.Errorf("error element = %q, want %q (message: %s)", verr.Element, wantElement, verr.Message)
	}
}

// TestValidateContentUnknownKeys covers rule 1, the security boundary: only
// field ids declared by the schema may be written to. This is the rule the
// agent's fill_field tool is held to, so it is checked in both completeness
// modes — an unknown key is never acceptable.
func TestValidateContentUnknownKeys(t *testing.T) {
	schema := testSchema()

	tests := []struct {
		name        string
		values      map[string]json.RawMessage
		wantField   string
		wantElement string
	}{
		{
			name:   "known field id is accepted",
			values: map[string]json.RawMessage{"fld_text": raw(`"hello"`)},
		},
		{
			name:        "unknown field id is rejected and named",
			values:      map[string]json.RawMessage{"fld_injected": raw(`"hello"`)},
			wantField:   "unknown",
			wantElement: "fld_injected",
		},
		{
			name:        "a section id is not a field id",
			values:      map[string]json.RawMessage{"sec_optional": raw(`"hello"`)},
			wantField:   "unknown",
			wantElement: "sec_optional",
		},
		{
			name: "one unknown key among known ones is still rejected",
			values: map[string]json.RawMessage{
				"fld_text":     raw(`"hello"`),
				"fld_unknown":  raw(`"hello"`),
				"fld_number":   raw(`"3"`),
				"fld_selected": raw(`"Split"`),
			},
			// Unknown keys are reported in sorted order, so the answer is the
			// same on every run despite Go's randomized map iteration.
			wantField:   "unknown",
			wantElement: "fld_selected",
		},
		{
			name:        "a null value under an unknown key is still a rejected write",
			values:      map[string]json.RawMessage{"fld_injected": raw(`null`)},
			wantField:   "unknown",
			wantElement: "fld_injected",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			// The rule holds regardless of the completeness mode.
			err := ValidateContent(schema, contentWith(tc.values), false)
			assertValidation(t, err, tc.wantField, tc.wantElement)

			values := tc.values
			for id, value := range completeValues() {
				values[id] = value
			}
			err = ValidateContent(schema, contentWith(values), true)
			assertValidation(t, err, tc.wantField, tc.wantElement)
		})
	}
}

// TestValidateContentTypeMatch covers rule 2: each value must match the shape
// its field's declared type implies. These run with requireComplete = false, so
// nothing here is a completeness failure in disguise.
func TestValidateContentTypeMatch(t *testing.T) {
	schema := testSchema()

	tests := []struct {
		name        string
		fieldID     string
		value       string
		wantField   string
		wantElement string
	}{
		// text
		{name: "text accepts a string", fieldID: "fld_text", value: `"some notes"`},
		{name: "text accepts the empty string", fieldID: "fld_text", value: `""`},
		{name: "text rejects a number", fieldID: "fld_text", value: `12`,
			wantField: "type", wantElement: "fld_text"},
		{name: "text rejects an array", fieldID: "fld_text", value: `["a"]`,
			wantField: "type", wantElement: "fld_text"},

		// number — a string on the wire, but a parseable one
		{name: "number accepts a numeric string", fieldID: "fld_number", value: `"12.5"`},
		{name: "number accepts the empty string", fieldID: "fld_number", value: `""`},
		{name: "number accepts a half-typed decimal", fieldID: "fld_number", value: `"3."`},
		{name: "number accepts a negative", fieldID: "fld_number", value: `"-4"`},
		{name: "number rejects a non-numeric string", fieldID: "fld_number", value: `"abc"`,
			wantField: "type", wantElement: "fld_number"},
		{name: "number rejects a JSON number", fieldID: "fld_number", value: `12.5`,
			wantField: "type", wantElement: "fld_number"},

		// select
		{name: "select accepts a declared option", fieldID: "fld_select", value: `"Split"`},
		{name: "select accepts the empty string", fieldID: "fld_select", value: `""`},
		{name: "select rejects an undeclared option", fieldID: "fld_select", value: `"Ductless"`,
			wantField: "type", wantElement: "fld_select"},
		{name: "select rejects an array", fieldID: "fld_select", value: `["Split"]`,
			wantField: "type", wantElement: "fld_select"},

		// checklist
		{name: "checklist accepts declared options", fieldID: "fld_checklist",
			value: `["Power isolated","Area cleared"]`},
		{name: "checklist accepts an empty array", fieldID: "fld_checklist", value: `[]`},
		{name: "checklist rejects an undeclared option", fieldID: "fld_checklist",
			value: `["Power isolated","Gas shut off"]`, wantField: "type", wantElement: "fld_checklist"},
		{name: "checklist rejects a bare string", fieldID: "fld_checklist", value: `"Power isolated"`,
			wantField: "type", wantElement: "fld_checklist"},
		{name: "checklist rejects non-string elements", fieldID: "fld_checklist", value: `[1,2]`,
			wantField: "type", wantElement: "fld_checklist"},

		// photo
		{name: "photo accepts an uploaded image", fieldID: "fld_photo",
			value: `{"dataUrl":"data:image/png;base64,iVBORw0KGgo=","caption":"Before"}`},
		{name: "photo accepts an empty photo", fieldID: "fld_photo",
			value: `{"dataUrl":null,"caption":""}`},
		{name: "photo accepts an optional fileName", fieldID: "fld_photo",
			value: `{"dataUrl":null,"caption":"","fileName":"unit.png"}`},
		{name: "photo rejects a bare string", fieldID: "fld_photo", value: `"data:image/png;base64,x"`,
			wantField: "type", wantElement: "fld_photo"},
		{name: "photo rejects a missing dataUrl key", fieldID: "fld_photo", value: `{"caption":""}`,
			wantField: "type", wantElement: "fld_photo"},
		{name: "photo rejects a missing caption key", fieldID: "fld_photo", value: `{"dataUrl":null}`,
			wantField: "type", wantElement: "fld_photo"},
		{name: "photo rejects a non-string dataUrl", fieldID: "fld_photo",
			value: `{"dataUrl":12,"caption":""}`, wantField: "type", wantElement: "fld_photo"},
		{name: "photo rejects an unrecognized key", fieldID: "fld_photo",
			value: `{"dataUrl":null,"caption":"","script":"x"}`, wantField: "type", wantElement: "fld_photo"},

		// signature
		{name: "signature accepts a data URL string", fieldID: "fld_signature",
			value: `"data:image/png;base64,iVBORw0KGgo="`},
		{name: "signature accepts null", fieldID: "fld_signature", value: `null`},
		{name: "signature rejects a number", fieldID: "fld_signature", value: `12`,
			wantField: "type", wantElement: "fld_signature"},
		{name: "signature rejects an object", fieldID: "fld_signature", value: `{"dataUrl":null}`,
			wantField: "type", wantElement: "fld_signature"},

		// null is "nothing filled in" for every type, and is legal on a draft
		{name: "null is accepted for text", fieldID: "fld_text", value: `null`},
		{name: "null is accepted for checklist", fieldID: "fld_checklist", value: `null`},
		{name: "null is accepted for photo", fieldID: "fld_photo", value: `null`},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			content := contentWith(map[string]json.RawMessage{tc.fieldID: raw(tc.value)})
			err := ValidateContent(schema, content, false)
			assertValidation(t, err, tc.wantField, tc.wantElement)
		})
	}
}

// TestValidateContentRequiredFields covers rule 3 in BOTH modes. The pairing is
// the point: the identical content must pass as a draft save and fail as an
// export. Getting this backwards makes autosave reject every half-filled
// report, which makes the renderer unusable.
func TestValidateContentRequiredFields(t *testing.T) {
	schema := testSchema()

	tests := []struct {
		name string
		// override replaces one required field's value with an empty one; a nil
		// override means the field is left out of the content entirely.
		fieldID  string
		override *string
	}{
		{name: "required text left empty", fieldID: "req_text", override: ptr(`""`)},
		{name: "required text absent", fieldID: "req_text"},
		{name: "required text whitespace only", fieldID: "req_text", override: ptr(`"   "`)},
		{name: "required number left empty", fieldID: "req_number", override: ptr(`""`)},
		{name: "required select left empty", fieldID: "req_select", override: ptr(`""`)},
		{name: "required checklist left empty", fieldID: "req_checklist", override: ptr(`[]`)},
		{name: "required checklist absent", fieldID: "req_checklist"},
		{name: "required photo with no image", fieldID: "req_photo", override: ptr(`{"dataUrl":null,"caption":""}`)},
		{name: "required photo absent", fieldID: "req_photo"},
		{name: "required signature unsigned", fieldID: "req_signature", override: ptr(`null`)},
		{name: "required signature absent", fieldID: "req_signature"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			values := completeValues()
			if tc.override == nil {
				delete(values, tc.fieldID)
			} else {
				values[tc.fieldID] = raw(*tc.override)
			}
			content := contentWith(values)

			// A draft save must accept it.
			assertValidation(t, ValidateContent(schema, content, false), "", "")

			// An export must reject it, naming the field.
			assertValidation(t, ValidateContent(schema, content, true), "required", tc.fieldID)
		})
	}
}

// TestValidateContentCompleteAccepted is the other half of rule 3: content that
// fills every required field passes in both modes. Without it, a validator that
// rejected everything would pass the tests above.
func TestValidateContentCompleteAccepted(t *testing.T) {
	schema := testSchema()
	content := contentWith(completeValues())
	// Optional fields left entirely absent must not block an export.
	assertValidation(t, ValidateContent(schema, content, false), "", "")
	assertValidation(t, ValidateContent(schema, content, true), "", "")
}

// TestValidateContentEmptyDraft is the autosave case in its purest form: a
// brand-new report with nothing filled in at all saves cleanly, and only fails
// once someone tries to export it.
func TestValidateContentEmptyDraft(t *testing.T) {
	schema := testSchema()
	content := ReportContent{}

	assertValidation(t, ValidateContent(schema, content, false), "", "")
	// The first required field in schema order is the one reported.
	assertValidation(t, ValidateContent(schema, content, true), "required", "req_text")
}

// TestValidateContentParts covers the Parts Used table: quantity is a string on
// the wire and a NUMERIC in the database, so an empty quantity is a legal
// mid-edit state while a non-numeric one is a rejected write in both modes.
func TestValidateContentParts(t *testing.T) {
	tests := []struct {
		name        string
		parts       []PartRow
		wantField   string
		wantElement string
	}{
		{
			name:  "numeric quantities are accepted",
			parts: []PartRow{{ID: "p1", Part: "Capacitor", PartNumber: "CAP-1", Quantity: "2"}},
		},
		{
			name:  "a fractional quantity is accepted",
			parts: []PartRow{{ID: "p1", Part: "Cable", Quantity: "2.5"}},
		},
		{
			name:  "an empty quantity is a legal mid-edit state",
			parts: []PartRow{{ID: "p1", Part: "Cable", Quantity: ""}},
		},
		{
			name:        "a non-numeric quantity is rejected and names the row",
			parts:       []PartRow{{ID: "p1", Part: "Cable", Quantity: "two"}},
			wantField:   "type",
			wantElement: "p1",
		},
		{
			name: "a row with no id is named by its position",
			parts: []PartRow{
				{ID: "p1", Part: "Cable", Quantity: "1"},
				{Part: "Belt", Quantity: "lots"},
			},
			wantField:   "type",
			wantElement: "parts[1]",
		},
	}

	schema := testSchema()
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			content := ReportContent{Values: completeValues(), Parts: tc.parts, FilledBy: FilledByManual}
			assertValidation(t, ValidateContent(schema, content, false), tc.wantField, tc.wantElement)
			assertValidation(t, ValidateContent(schema, content, true), tc.wantField, tc.wantElement)
		})
	}
}

// TestValidateContentFilledBy checks the structural rule guarding the
// service_reports.filled_by CHECK constraint: an unrecognized value is a 422
// naming nothing, rather than a constraint violation surfacing as a 500.
func TestValidateContentFilledBy(t *testing.T) {
	schema := testSchema()

	for _, filledBy := range []string{"", FilledByManual, FilledByAgent, FilledByMixed} {
		content := ReportContent{Values: completeValues(), FilledBy: filledBy}
		assertValidation(t, ValidateContent(schema, content, true), "", "")
	}

	content := ReportContent{Values: completeValues(), FilledBy: "robot"}
	assertValidation(t, ValidateContent(schema, content, true), "structure", "")
}

// TestValidateContentUsesSnapshotNotLiveSchema pins the behavior the whole
// design rests on: content is judged against the schema it is handed — the
// report's snapshot — so a field the template has since dropped still validates
// for a report that was filled while it existed.
func TestValidateContentUsesSnapshotNotLiveSchema(t *testing.T) {
	snapshot := templates.TemplateSchema{
		Version: 1,
		Sections: []templates.Section{{
			ID:    "sec",
			Label: "Section",
			Fields: []templates.Field{
				{ID: "fld_retired", Type: templates.FieldText, Label: "Retired field", Required: true},
			},
		}},
	}
	edited := templates.TemplateSchema{
		Version: 1,
		Sections: []templates.Section{{
			ID:    "sec",
			Label: "Section",
			Fields: []templates.Field{
				{ID: "fld_new", Type: templates.FieldText, Label: "New field"},
			},
		}},
	}

	content := contentWith(map[string]json.RawMessage{"fld_retired": raw(`"filled in last week"`)})

	assertValidation(t, ValidateContent(snapshot, content, true), "", "")
	// Against the edited template the same content is an unknown key — which
	// is exactly why nothing validates against the live schema.
	assertValidation(t, ValidateContent(edited, content, true), "unknown", "fld_retired")
}

func ptr(s string) *string { return &s }
