package reports

import (
	"encoding/json"
	"strconv"
	"strings"
)

// The three ways a report can have been filled. They mirror the
// service_reports.filled_by CHECK constraint (0006_service_reports.sql) and the
// FilledBy union in frontend/src/pages/ReportEditor/reportContent.ts.
const (
	FilledByManual = "manual"
	FilledByAgent  = "agent"
	FilledByMixed  = "mixed"
)

// The three report lifecycle states, mirroring the service_reports.status
// CHECK constraint and the ReportRecord.status union on the wire.
const (
	StatusDraft     = "draft"
	StatusSubmitted = "submitted"
	StatusExported  = "exported"
)

// PartRow is one line of the Parts Used table.
//
// EVERY FIELD IS A STRING ON THE WIRE, including Quantity. That is deliberate
// and is the renderer's contract (reportContent.ts): quantity is an
// in-progress form value, so "" and "3." are both legal mid-edit states that
// must round-trip unchanged rather than collapsing to 0 or NaN. The NUMERIC
// column underneath is the persistence concern — the store parses on write and
// formats back on read (see quantityToNumeric / quantityFromNumeric).
type PartRow struct {
	ID         string `json:"id"`
	Part       string `json:"part"`
	PartNumber string `json:"partNumber"`
	Quantity   string `json:"quantity"`
}

// ReportContent is the Go mirror of the frontend ReportContent: the values a
// technician (or the agent) filled into a template, the Parts Used table, and
// how it was filled.
//
// WHY Values IS map[string]json.RawMessage: a value's shape depends on the type
// of the field it belongs to, which is only knowable with the schema in hand.
// Holding the raw JSON lets ValidateContent check each value against its
// declared field type and reject anything that does not match, instead of
// decoding into an `any` first and losing the distinction between a JSON null,
// a missing key, and an empty string. It is also what makes the unknown-key
// rule enforceable: an unrecognized key is rejected before anything looks
// inside it.
type ReportContent struct {
	Values   map[string]json.RawMessage `json:"values"`
	Parts    []PartRow                  `json:"parts"`
	FilledBy string                     `json:"filledBy"`
}

// normalized returns a copy of c safe to marshal back to the client: a non-nil
// Values map and a non-nil Parts slice so the JSON carries {} and [] rather
// than null (the frontend indexes both without a null check), and a FilledBy
// that defaults to "manual" when the caller omitted it.
func (c ReportContent) normalized() ReportContent {
	out := c
	if out.Values == nil {
		out.Values = make(map[string]json.RawMessage)
	}
	if out.Parts == nil {
		out.Parts = make([]PartRow, 0)
	}
	if out.FilledBy == "" {
		out.FilledBy = FilledByManual
	}
	return out
}

// knownFilledBy reports whether value is one of the three filled_by values the
// database CHECK constraint accepts. Anything else is rejected at validation
// time rather than being allowed to fail as a constraint violation mid-write.
func knownFilledBy(value string) bool {
	switch value {
	case FilledByManual, FilledByAgent, FilledByMixed:
		return true
	}
	return false
}

// photoValue is the decoded shape of a `photo` field's value, mirroring
// PhotoValue in reportContent.ts. DataURL is a pointer so a JSON null (nothing
// uploaded yet) is distinguishable from an empty string.
type photoValue struct {
	DataURL  *string `json:"dataUrl"`
	Caption  string  `json:"caption"`
	FileName string  `json:"fileName,omitempty"`
}

// isJSONNull reports whether raw is the JSON literal null. A missing value and
// an explicit null are treated the same everywhere in this package: both mean
// "nothing filled in here".
func isJSONNull(raw json.RawMessage) bool {
	return len(raw) == 0 || string(trimJSONSpace(raw)) == "null"
}

// trimJSONSpace strips the whitespace JSON permits around a value, so literal
// comparisons against raw bytes are not defeated by an encoder that indents.
func trimJSONSpace(raw json.RawMessage) json.RawMessage {
	return json.RawMessage(strings.TrimSpace(string(raw)))
}

// decodeString decodes raw as a JSON string. ok is false when raw is any other
// JSON type, which the caller reports as a type mismatch naming the field.
func decodeString(raw json.RawMessage) (string, bool) {
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", false
	}
	return s, true
}

// decodeStringSlice decodes raw as a JSON array of strings. ok is false when
// raw is not an array, or when any element is not a string.
func decodeStringSlice(raw json.RawMessage) ([]string, bool) {
	var values []string
	if err := json.Unmarshal(raw, &values); err != nil {
		return nil, false
	}
	return values, true
}

// quantityToNumeric converts a wire quantity string into the value written to
// the parts_used.quantity NUMERIC column. An empty string means "not entered
// yet" and becomes 0; anything else has already been proven parseable by
// ValidateContent, so a parse failure here can only mean the two drifted apart
// and is reported to the caller rather than silently zeroed — a wrong quantity
// is a wrong invoice.
func quantityToNumeric(quantity string) (float64, error) {
	trimmed := strings.TrimSpace(quantity)
	if trimmed == "" {
		return 0, nil
	}
	return strconv.ParseFloat(trimmed, 64)
}

// quantityFromNumeric formats a parts_used.quantity value read back from
// PostgreSQL into the wire string.
//
// NUMERIC(12,3) always comes back fully scaled — "3" was stored and "3.000"
// comes back — so the trailing zeros are trimmed to give the renderer the
// value the technician actually typed. The fractional digits that carry
// information are kept: "2.500" becomes "2.5", not "2".
func quantityFromNumeric(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if !strings.Contains(trimmed, ".") {
		return trimmed
	}
	trimmed = strings.TrimRight(trimmed, "0")
	return strings.TrimSuffix(trimmed, ".")
}
