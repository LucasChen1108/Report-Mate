package dashboard

import (
	"encoding/json"
	"net/url"
	"testing"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// These need no database: they cover the pure half of the package — how a
// stored value becomes a display string, and how a query string becomes a
// filter — so `go test ./...` exercises them on a machine with no Postgres.

func TestDisplayValue(t *testing.T) {
	cases := []struct {
		name string
		raw  string
		want string
	}{
		{"text", `"Replaced the blower"`, "Replaced the blower"},
		{"empty text", `""`, ""},
		{"integer", `42`, "42"},
		{"number keeps its scale", `12.50`, "12.50"},
		{"big integer is not floated", `900719925474099123`, "900719925474099123"},
		{"null is empty, not missing", `null`, ""},
		{"true", `true`, "Yes"},
		{"false", `false`, "No"},
		{"checklist", `["Gloves","Hard hat"]`, "Gloves, Hard hat"},
		{"checklist drops blanks", `["Gloves","",null,"Hard hat"]`, "Gloves, Hard hat"},
		{"empty list", `[]`, ""},
		{"single selection", `["Split"]`, "Split"},
		{"unexpected object renders compactly", `{"a": 1}`, `{"a":1}`},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := displayValue([]byte(tc.raw)); got != tc.want {
				t.Errorf("displayValue(%s) = %q, want %q", tc.raw, got, tc.want)
			}
		})
	}
}

func TestRenderCellAttachments(t *testing.T) {
	photo := TableColumn{FieldID: "f_photo", Type: templates.FieldPhoto}
	sig := TableColumn{FieldID: "f_sig", Type: templates.FieldSignature}
	text := TableColumn{FieldID: "f_notes", Type: templates.FieldText}

	row := reportRow{
		Values:      map[string]json.RawMessage{},
		Attachments: map[string]bool{"f_photo": true, "f_sig": false},
	}

	if got := renderCell(photo, row); got != photoCell {
		t.Errorf("filled photo = %q, want %q", got, photoCell)
	}
	if got := renderCell(sig, row); got != "" {
		t.Errorf("unsigned signature = %q, want empty", got)
	}
	if got := renderCell(text, row); got != missingCell {
		t.Errorf("absent text field = %q, want %q", got, missingCell)
	}

	// A field the report has no key for at all — an older revision — is
	// missing, not empty.
	row.Attachments = map[string]bool{}
	if got := renderCell(photo, row); got != missingCell {
		t.Errorf("photo field absent from the report = %q, want %q", got, missingCell)
	}
}

func TestFlattenColumnsAndAttachmentIDs(t *testing.T) {
	schema := templates.TemplateSchema{
		Version: 1,
		Sections: []templates.Section{
			{ID: "s1", Label: "Visit", Fields: []templates.Field{
				{ID: "f1", Type: templates.FieldText, Label: "Notes"},
				{ID: "f2", Type: templates.FieldPhoto, Label: "Photo"},
			}},
			{ID: "s2", Label: "Sign-off", Fields: []templates.Field{
				{ID: "f3", Type: templates.FieldSignature, Label: "Signature"},
			}},
		},
	}

	columns := flattenColumns(schema)
	if len(columns) != 3 {
		t.Fatalf("got %d columns, want 3", len(columns))
	}
	if columns[0].FieldID != "f1" || columns[1].FieldID != "f2" || columns[2].FieldID != "f3" {
		t.Errorf("columns are out of section order: %+v", columns)
	}
	if columns[2].SectionLabel != "Sign-off" {
		t.Errorf("sectionLabel = %q, want %q", columns[2].SectionLabel, "Sign-off")
	}

	ids := attachmentFieldIDs(schema)
	if len(ids) != 2 || ids[0] != "f2" || ids[1] != "f3" {
		t.Errorf("attachmentFieldIDs = %v, want [f2 f3]", ids)
	}

	// An empty schema must still produce a non-nil slice: it serializes as []
	// rather than null, which the frontend iterates without a guard.
	if cols := flattenColumns(templates.TemplateSchema{Version: 1}); cols == nil {
		t.Error("flattenColumns returned nil for an empty schema")
	}
}

func TestCSVColumnHeadersQualifyDuplicates(t *testing.T) {
	columns := []TableColumn{
		{Label: "Notes", SectionLabel: "Visit"},
		{Label: "Notes", SectionLabel: "Sign-off"},
		{Label: "Meter", SectionLabel: "Visit"},
	}
	got := csvColumnHeaders(columns)
	want := []string{"Visit / Notes", "Sign-off / Notes", "Meter"}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("header[%d] = %q, want %q", i, got[i], want[i])
		}
	}
}

func TestCSVFilename(t *testing.T) {
	now := time.Date(2026, 9, 21, 0, 0, 0, 0, time.UTC)
	cases := map[string]string{
		"HVAC Service Visit": "hvac-service-visit-reports-2026-09-21.csv",
		"  Odd//Name!!  ":    "odd-name-reports-2026-09-21.csv",
		"日本語":                "template-reports-2026-09-21.csv",
	}
	for name, want := range cases {
		if got := csvFilename(name, now); got != want {
			t.Errorf("csvFilename(%q) = %q, want %q", name, got, want)
		}
	}
}

func TestParseTableParams(t *testing.T) {
	params, err := parseTableParams(url.Values{})
	if err != nil {
		t.Fatalf("empty query: %v", err)
	}
	if params.limit != defaultLimit || params.offset != 0 || params.from != nil || params.to != nil {
		t.Errorf("defaults = %+v", params)
	}

	params, err = parseTableParams(url.Values{
		"to":    {"2026-03-04"},
		"limit": {"5000"},
		"q":     {"  acme  "},
	})
	if err != nil {
		t.Fatalf("valid query: %v", err)
	}
	if params.limit != maxLimit {
		t.Errorf("limit = %d, want it clamped to %d", params.limit, maxLimit)
	}
	if params.search != "acme" {
		t.Errorf("q = %q, want it trimmed", params.search)
	}
	// The inclusive day the client sends becomes an exclusive next-midnight, so
	// reports filed during that day are inside the window.
	wantTo := time.Date(2026, 3, 5, 0, 0, 0, 0, time.UTC)
	if params.to == nil || !params.to.Equal(wantTo) {
		t.Errorf("to = %v, want %v", params.to, wantTo)
	}

	for _, bad := range []url.Values{
		{"status": {"archived"}},
		{"from": {"04-03-2026"}},
		{"to": {"tomorrow"}},
		{"limit": {"0"}},
		{"limit": {"many"}},
		{"offset": {"-1"}},
	} {
		if _, err := parseTableParams(bad); err == nil {
			t.Errorf("parseTableParams(%v) accepted an invalid value", bad)
		}
	}
}

func TestIsUUID(t *testing.T) {
	valid := []string{
		"22222222-2222-2222-2222-222222222222",
		"C1D2BCD1-933D-4218-B621-632A538434BC",
	}
	invalid := []string{
		"", "not-a-uuid", "22222222222222222222222222222222",
		"22222222-2222-2222-2222-22222222222g",
		"22222222+2222-2222-2222-222222222222",
		"22222222-2222-2222-2222-222222222222 ",
	}
	for _, s := range valid {
		if !isUUID(s) {
			t.Errorf("isUUID(%q) = false, want true", s)
		}
	}
	for _, s := range invalid {
		if isUUID(s) {
			t.Errorf("isUUID(%q) = true, want false", s)
		}
	}
}
