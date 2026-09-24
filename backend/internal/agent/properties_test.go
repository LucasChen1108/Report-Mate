package agent

// Pure-logic property tests for the agent (no database, no gateway).
//
// ENGINE NOTE: the ai-agent spec specifies pgregory.me/rapid; that module is
// not fetchable in this environment, so these use the standard library's
// testing/quick. Every property's assertion, tag, and >=100-iteration budget is
// preserved. Each test sets quick.Config{MaxCount: 100} (or drives its own
// >=100 loop where the input space is enumerated rather than generated).

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"strconv"
	"strings"
	"testing"
	"testing/quick"

	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

const propIterations = 100

// allFieldTypes is the closed set of the six template field types, used by
// generators that must exercise every type including the non-fillable ones.
var allFieldTypes = []templates.FieldType{
	templates.FieldText,
	templates.FieldNumber,
	templates.FieldSelect,
	templates.FieldChecklist,
	templates.FieldPhoto,
	templates.FieldSignature,
}

// randFieldType returns a random one of the six field types.
func randFieldType(r *rand.Rand) templates.FieldType {
	return allFieldTypes[r.Intn(len(allFieldTypes))]
}

// randSchema builds a random schema (1..3 sections, 0..4 fields each) spanning
// all six field types, with select/checklist fields carrying 1..3 options.
// Field ids are unique across the whole schema (templates.Validate guarantees
// this in production; the generator upholds it so lookups are well-defined).
func randSchema(r *rand.Rand) templates.TemplateSchema {
	var sections []templates.Section
	nSections := 1 + r.Intn(3)
	fieldNo := 0
	for s := 0; s < nSections; s++ {
		var fields []templates.Field
		nFields := r.Intn(5)
		for f := 0; f < nFields; f++ {
			fieldNo++
			typ := randFieldType(r)
			var opts []string
			if typ == templates.FieldSelect || typ == templates.FieldChecklist {
				nOpts := 1 + r.Intn(3)
				for o := 0; o < nOpts; o++ {
					opts = append(opts, fmt.Sprintf("opt%d_%d", fieldNo, o))
				}
			}
			fields = append(fields, field(fmt.Sprintf("fld_%d", fieldNo), typ, r.Intn(2) == 0, opts...))
		}
		sections = append(sections, section(fmt.Sprintf("sec_%d", s), fields...))
	}
	return schemaOf(sections...)
}

// allFields flattens a schema's fields in order.
func allFields(schema templates.TemplateSchema) []templates.Field {
	var out []templates.Field
	for _, sec := range schema.Sections {
		out = append(out, sec.Fields...)
	}
	return out
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 1: fill_field never writes a field outside the
// fillable schema.
//
// For a random schema and a random target field id, fill_field accepts iff the
// id is declared by the schema AND the field is a fillable type
// (text/number/select/checklist); otherwise content is left unchanged.
// Validates: Requirements 2.1, 2.2, 2.3, 3.4.
// -----------------------------------------------------------------------------
func TestProperty1_FillFieldRespectsFillableSchema(t *testing.T) {
	r := rand.New(rand.NewSource(1))
	for i := 0; i < propIterations; i++ {
		schema := randSchema(r)
		st, content := runStateFor(schema)

		// Pick a target: usually a real field, sometimes a bogus id.
		var targetID string
		var targetType templates.FieldType
		declared := allFields(schema)
		useReal := len(declared) > 0 && r.Intn(2) == 0
		if useReal {
			fl := declared[r.Intn(len(declared))]
			targetID, targetType = fl.ID, fl.Type
		} else {
			targetID = "nonexistent_" + strconv.Itoa(i)
		}

		// A value that is valid for the target's type (so acceptance hinges on
		// the schema/type gate, not the value): use "" which is valid for
		// text/select/number and, for checklist, [].
		value := chooseValidValue(targetType)

		call := toolCall{Tool: "fill_field", FieldID: targetID, Value: value}
		res := st.registryDispatch(call)

		shouldAccept := useReal && fillableType(targetType)
		_, present := content.Values[targetID]
		if shouldAccept {
			if !res.Ok {
				t.Fatalf("iter %d: expected accept for fillable declared field %q (%s), got reject: %s", i, targetID, targetType, res.Detail)
			}
			if !present {
				t.Fatalf("iter %d: accepted fill did not write %q", i, targetID)
			}
		} else {
			if res.Ok {
				t.Fatalf("iter %d: expected reject for id=%q real=%v type=%s", i, targetID, useReal, targetType)
			}
			if present {
				t.Fatalf("iter %d: rejected fill still wrote %q — content must be unchanged", i, targetID)
			}
		}
	}
}

// chooseValidValue returns a type-valid empty value for a field type. photo and
// signature are not fillable; their value is irrelevant (returns null).
func chooseValidValue(typ templates.FieldType) json.RawMessage {
	switch typ {
	case templates.FieldChecklist:
		return json.RawMessage(`[]`)
	case templates.FieldText, templates.FieldSelect, templates.FieldNumber:
		return json.RawMessage(`""`)
	default:
		return json.RawMessage(`null`)
	}
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 2: an accepted fill_field value is type-valid and
// within declared options.
//
// For fillable fields and generated valid/invalid values, fill_field accepts
// iff the value is type-valid and (select/checklist) drawn from the field's
// options; otherwise the stored value is unchanged.
// Validates: Requirements 2.4, 2.5, 2.6.
// -----------------------------------------------------------------------------
func TestProperty2_AcceptedFillValueIsTypeAndOptionValid(t *testing.T) {
	r := rand.New(rand.NewSource(2))
	for i := 0; i < propIterations; i++ {
		// A single fillable field with known options.
		typ := []templates.FieldType{templates.FieldText, templates.FieldNumber, templates.FieldSelect, templates.FieldChecklist}[r.Intn(4)]
		opts := []string{"alpha", "beta", "gamma"}
		fl := field("fld_x", typ, false, opts...)
		schema := schemaOf(section("sec", fl))
		st, content := runStateFor(schema)

		value, wantValid := generateValueForType(r, typ, opts)
		call := toolCall{Tool: "fill_field", FieldID: "fld_x", Value: value}
		res := st.registryDispatch(call)

		if wantValid != res.Ok {
			t.Fatalf("iter %d: type=%s value=%s wantValid=%v gotOk=%v detail=%q", i, typ, string(value), wantValid, res.Ok, res.Detail)
		}
		if !res.Ok {
			if _, present := content.Values["fld_x"]; present {
				t.Fatalf("iter %d: rejected value still stored for type=%s value=%s", i, typ, string(value))
			}
		}
	}
}

// generateValueForType returns a JSON value for the given fillable type plus
// whether fill_field should accept it, exercising both valid and invalid cases.
func generateValueForType(r *rand.Rand, typ templates.FieldType, opts []string) (json.RawMessage, bool) {
	switch typ {
	case templates.FieldText:
		switch r.Intn(3) {
		case 0:
			return json.RawMessage(`"some notes"`), true
		case 1:
			return json.RawMessage(`""`), true
		default:
			return json.RawMessage(`123`), false // number is not a string
		}
	case templates.FieldNumber:
		switch r.Intn(4) {
		case 0:
			return json.RawMessage(`"42.5"`), true // numeric string
		case 1:
			return json.RawMessage(`7`), true // JSON number, normalized
		case 2:
			return json.RawMessage(`""`), true // empty mid-edit state
		default:
			return json.RawMessage(`"abc"`), false // not a number
		}
	case templates.FieldSelect:
		switch r.Intn(3) {
		case 0:
			return json.RawMessage(`"beta"`), true // in options
		case 1:
			return json.RawMessage(`""`), true // clearing is allowed
		default:
			return json.RawMessage(`"zeta"`), false // not an option
		}
	case templates.FieldChecklist:
		switch r.Intn(3) {
		case 0:
			return json.RawMessage(`["alpha","gamma"]`), true
		case 1:
			return json.RawMessage(`[]`), true
		default:
			return json.RawMessage(`["alpha","nope"]`), false // one not an option
		}
	}
	return json.RawMessage(`null`), false
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 4: a run that does not reach save_draft never
// mutates the persisted draft.
//
// A run that fills N fields then fails (parse failure, iteration cap, or
// gateway error) must never call persist, so the persisted draft is untouched.
// (In-memory layer: assert persist is not invoked and Saved is false.)
// Validates: Requirements 9.1, 9.2, 9.3.
// -----------------------------------------------------------------------------
func TestProperty4_NonSavedRunNeverPersists(t *testing.T) {
	r := rand.New(rand.NewSource(4))
	schema := schemaOf(section("sec",
		field("fld_notes", templates.FieldText, false),
		field("fld_count", templates.FieldNumber, false),
	))

	for i := 0; i < propIterations; i++ {
		nFills := r.Intn(3)
		var replies []string
		for f := 0; f < nFills; f++ {
			if f%2 == 0 {
				replies = append(replies, `{"tool":"fill_field","field_id":"fld_notes","value":"work done"}`)
			} else {
				replies = append(replies, `{"tool":"fill_field","field_id":"fld_count","value":"3"}`)
			}
		}

		// Choose a non-save termination mode.
		var client *scriptedClient
		switch r.Intn(3) {
		case 0: // parse failure — a non-tool-call reply
			replies = append(replies, `this is not json`)
			client = &scriptedClient{replies: replies}
		case 1: // gateway error on the next call
			client = &scriptedClient{replies: replies, err: errGatewayUnavailable}
		default: // iteration cap — never emit save_draft; fallback is a no-op fill
			client = &scriptedClient{replies: replies, fallback: `{"tool":"fill_field","field_id":"fld_notes","value":"loop"}`}
		}

		persist := &recordingPersist{}
		runner := NewRunner(client)
		res, _ := runner.Run(context.Background(), RunInput{
			ReportID: "r1", Schema: schema, Content: emptyContent(),
			Messages: []ConversationMessage{{Role: "technician", Content: "account"}},
		}, persist.fn())

		if persist.calls != 0 {
			t.Fatalf("iter %d: persist called %d times on a non-saved run (%s)", i, persist.calls, res.TerminatedBy)
		}
		if res.Saved {
			t.Fatalf("iter %d: Saved=true on a non-saved run (%s)", i, res.TerminatedBy)
		}
	}
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 7: flagged fields are returned as a set and never
// appear in persisted content.
//
// Given a sequence of flag_missing_field calls (with duplicates), the returned
// FlaggedFieldIDs are the distinct ids and none carries a value in content.
// Validates: Requirements 3.2, 3.3.
// -----------------------------------------------------------------------------
func TestProperty7_FlaggedFieldsAreASetAndUnwritten(t *testing.T) {
	r := rand.New(rand.NewSource(7))
	schema := schemaOf(section("sec",
		field("fld_a", templates.FieldText, true),
		field("fld_b", templates.FieldNumber, true),
		field("fld_c", templates.FieldSelect, true, "x", "y"),
	))
	ids := []string{"fld_a", "fld_b", "fld_c"}

	for i := 0; i < propIterations; i++ {
		nFlags := r.Intn(6)
		expected := map[string]struct{}{}
		var replies []string
		for f := 0; f < nFlags; f++ {
			id := ids[r.Intn(len(ids))]
			expected[id] = struct{}{}
			replies = append(replies, fmt.Sprintf(`{"tool":"flag_missing_field","field_id":%q}`, id))
		}
		replies = append(replies, `{"tool":"save_draft"}`)

		persist := &recordingPersist{}
		runner := NewRunner(&scriptedClient{replies: replies})
		res, err := runner.Run(context.Background(), RunInput{
			ReportID: "r1", Schema: schema, Content: emptyContent(),
			Messages: []ConversationMessage{{Role: "technician", Content: "account"}},
		}, persist.fn())
		if err != nil {
			t.Fatalf("iter %d: unexpected run error: %v", i, err)
		}

		// Returned ids are exactly the distinct set (sorted, deduped).
		if len(res.FlaggedFieldIDs) != len(expected) {
			t.Fatalf("iter %d: got %d flagged, want %d distinct: %v", i, len(res.FlaggedFieldIDs), len(expected), res.FlaggedFieldIDs)
		}
		for _, id := range res.FlaggedFieldIDs {
			if _, ok := expected[id]; !ok {
				t.Fatalf("iter %d: unexpected flagged id %q", i, id)
			}
			if _, wrote := persist.last.Values[id]; wrote {
				t.Fatalf("iter %d: flagged id %q carries a value in persisted content", i, id)
			}
		}
		// Sorted / deduped.
		for j := 1; j < len(res.FlaggedFieldIDs); j++ {
			if res.FlaggedFieldIDs[j-1] >= res.FlaggedFieldIDs[j] {
				t.Fatalf("iter %d: flagged ids not strictly sorted/deduped: %v", i, res.FlaggedFieldIDs)
			}
		}
	}
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 9: tool-call parsing round-trips through code
// fences.
//
// A valid tool call, formatted bare / fenced / with surrounding whitespace,
// parses back to the same call.
// Validates: Requirements 6.3.
// -----------------------------------------------------------------------------
func TestProperty9_ToolCallParsingRoundTrips(t *testing.T) {
	cfg := &quick.Config{MaxCount: propIterations, Rand: rand.New(rand.NewSource(9))}

	roundTrips := func(seed uint32) bool {
		r := rand.New(rand.NewSource(int64(seed)))
		call := randValidToolCall(r)
		encoded, err := json.Marshal(call)
		if err != nil {
			return false
		}

		for _, formatted := range formatVariants(string(encoded), r) {
			got, perr := parseToolCall(formatted)
			if perr != nil {
				return false
			}
			if !toolCallsEqual(got, call) {
				return false
			}
		}
		return true
	}

	if err := quick.Check(roundTrips, cfg); err != nil {
		t.Fatalf("tool-call round-trip through code fences failed: %v", err)
	}
}

// randValidToolCall builds a random valid tool call across the tool variants.
func randValidToolCall(r *rand.Rand) toolCall {
	switch r.Intn(5) {
	case 0:
		return toolCall{Tool: "get_template_schema"}
	case 1:
		return toolCall{Tool: "get_parts_catalog"}
	case 2:
		return toolCall{Tool: "get_job_history", JobID: fmt.Sprintf("job-%d", r.Intn(1000))}
	case 3:
		return toolCall{Tool: "flag_missing_field", FieldID: fmt.Sprintf("fld_%d", r.Intn(1000))}
	default:
		return toolCall{Tool: "fill_field", FieldID: fmt.Sprintf("fld_%d", r.Intn(1000)), Value: json.RawMessage(`"a value"`)}
	}
}

// formatVariants returns the same JSON object formatted bare, ```json-fenced,
// ```-fenced, and with surrounding whitespace.
func formatVariants(jsonObj string, r *rand.Rand) []string {
	return []string{
		jsonObj,
		"```json\n" + jsonObj + "\n```",
		"```\n" + jsonObj + "\n```",
		"  \n\t" + jsonObj + "\n  ",
		"```json\n" + jsonObj + "\n```\n\n",
	}
}

// toolCallsEqual compares two tool calls by their populated fields (Value is
// compared as trimmed JSON text).
func toolCallsEqual(a, b toolCall) bool {
	return a.Tool == b.Tool &&
		a.FieldID == b.FieldID &&
		a.JobID == b.JobID &&
		a.Question == b.Question &&
		strings.TrimSpace(string(a.Value)) == strings.TrimSpace(string(b.Value))
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 10: an unparseable assistant message terminates
// the run without dispatch.
//
// Parse layer: parseToolCall returns an error for non-tool-call strings (prose,
// partial JSON, arrays, bare scalars).
// Loop layer: a mock client emitting such content terminates with
// TerminatedBy=="parse_failure", dispatching no tool.
// Validates: Requirements 6.5.
// -----------------------------------------------------------------------------
func TestProperty10_UnparseableMessageTerminatesWithoutDispatch(t *testing.T) {
	r := rand.New(rand.NewSource(10))
	unparseable := []string{
		"I filled in the report for you.",
		`["fill_field","fld_x"]`,
		`{"no_tool_here":true}`,
		`{"tool":`,
		`42`,
		`"just a string"`,
		"```json\nnot json\n```",
		``,
	}

	for i := 0; i < propIterations; i++ {
		content := unparseable[r.Intn(len(unparseable))]

		// Parse layer.
		if _, err := parseToolCall(content); err == nil {
			t.Fatalf("iter %d: parseToolCall accepted an unparseable message: %q", i, content)
		}

		// Loop layer: the first reply is unparseable, so no tool dispatches.
		schema := schemaOf(section("sec", field("fld_x", templates.FieldText, false)))
		persist := &recordingPersist{}
		client := &scriptedClient{replies: []string{content}}
		runner := NewRunner(client)
		res, err := runner.Run(context.Background(), RunInput{
			ReportID: "r1", Schema: schema, Content: emptyContent(),
			Messages: []ConversationMessage{{Role: "technician", Content: "account"}},
		}, persist.fn())
		if err != nil {
			t.Fatalf("iter %d: unexpected error: %v", i, err)
		}
		if res.TerminatedBy != "parse_failure" {
			t.Fatalf("iter %d: terminatedBy=%q, want parse_failure (content=%q)", i, res.TerminatedBy, content)
		}
		if persist.calls != 0 {
			t.Fatalf("iter %d: persist called on a parse failure", i)
		}
		// No tool entries in the log (only chat + terminate).
		for _, e := range res.Log.Entries {
			if e.Kind == "tool" {
				t.Fatalf("iter %d: a tool was dispatched on a parse failure: %s", i, e.Tool)
			}
		}
	}
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 11: the loop always terminates within the
// iteration cap.
//
// A mock client emitting >=maxIters non-save replies calls Chat at most
// maxIters times and terminates with iteration_cap; a save_draft reply
// terminates immediately.
// Validates: Requirements 6.6.
// -----------------------------------------------------------------------------
func TestProperty11_LoopTerminatesWithinIterationCap(t *testing.T) {
	r := rand.New(rand.NewSource(11))
	schema := schemaOf(section("sec", field("fld_x", templates.FieldText, false)))

	for i := 0; i < propIterations; i++ {
		if r.Intn(2) == 0 {
			// Never save: fallback keeps emitting a valid, non-terminal fill.
			client := &scriptedClient{fallback: `{"tool":"fill_field","field_id":"fld_x","value":"x"}`}
			runner := NewRunner(client)
			res, err := runner.Run(context.Background(), RunInput{
				ReportID: "r1", Schema: schema, Content: emptyContent(),
				Messages: []ConversationMessage{{Role: "technician", Content: "account"}},
			}, (&recordingPersist{}).fn())
			if err != nil {
				t.Fatalf("iter %d: unexpected error: %v", i, err)
			}
			if res.TerminatedBy != "iteration_cap" {
				t.Fatalf("iter %d: terminatedBy=%q, want iteration_cap", i, res.TerminatedBy)
			}
			if client.callCount() > defaultMaxIters {
				t.Fatalf("iter %d: Chat called %d times, cap is %d", i, client.callCount(), defaultMaxIters)
			}
		} else {
			// save_draft on the first reply terminates immediately.
			client := &scriptedClient{replies: []string{`{"tool":"save_draft"}`}}
			runner := NewRunner(client)
			res, err := runner.Run(context.Background(), RunInput{
				ReportID: "r1", Schema: schema, Content: emptyContent(),
				Messages: []ConversationMessage{{Role: "technician", Content: "account"}},
			}, (&recordingPersist{}).fn())
			if err != nil {
				t.Fatalf("iter %d: unexpected error: %v", i, err)
			}
			if res.TerminatedBy != "save_draft" {
				t.Fatalf("iter %d: terminatedBy=%q, want save_draft", i, res.TerminatedBy)
			}
			if client.callCount() != 1 {
				t.Fatalf("iter %d: Chat called %d times, want 1 for immediate save", i, client.callCount())
			}
		}
	}
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 12: the run log records one ordered entry per
// dispatch and sums token usage.
//
// For a random tool-call + token sequence, the log has one ordered tool entry
// per dispatched tool, chat entries carry the per-call tokens, and
// TotalTokens() equals the sum of reported usage.
// Validates: Requirements 8.1, 8.2, 8.3.
// -----------------------------------------------------------------------------
func TestProperty12_RunLogOrderingAndTokenSum(t *testing.T) {
	r := rand.New(rand.NewSource(12))
	schema := schemaOf(section("sec",
		field("fld_a", templates.FieldText, false),
		field("fld_b", templates.FieldSelect, false, "x", "y"),
	))

	for i := 0; i < propIterations; i++ {
		nTools := r.Intn(5) // number of non-terminal dispatched tools
		tokensPerCall := 1 + r.Intn(50)
		var replies []string
		wantToolNames := []string{}
		for tI := 0; tI < nTools; tI++ {
			switch r.Intn(3) {
			case 0:
				replies = append(replies, `{"tool":"get_template_schema"}`)
				wantToolNames = append(wantToolNames, "get_template_schema")
			case 1:
				replies = append(replies, `{"tool":"fill_field","field_id":"fld_a","value":"hi"}`)
				wantToolNames = append(wantToolNames, "fill_field")
			default:
				replies = append(replies, `{"tool":"flag_missing_field","field_id":"fld_b"}`)
				wantToolNames = append(wantToolNames, "flag_missing_field")
			}
		}
		replies = append(replies, `{"tool":"save_draft"}`)

		client := &scriptedClient{replies: replies, tokensPerCall: tokensPerCall}
		runner := NewRunner(client)
		res, err := runner.Run(context.Background(), RunInput{
			ReportID: "r1", Schema: schema, Content: emptyContent(),
			Messages: []ConversationMessage{{Role: "technician", Content: "account"}},
		}, (&recordingPersist{}).fn())
		if err != nil {
			t.Fatalf("iter %d: unexpected error: %v", i, err)
		}

		// One ordered tool entry per dispatched (non-terminal) tool.
		var gotToolNames []string
		lastSeq := -1
		for _, e := range res.Log.Entries {
			if e.Seq <= lastSeq {
				t.Fatalf("iter %d: log seq not strictly increasing: %d after %d", i, e.Seq, lastSeq)
			}
			lastSeq = e.Seq
			if e.Kind == "tool" {
				gotToolNames = append(gotToolNames, e.Tool)
			}
		}
		if strings.Join(gotToolNames, ",") != strings.Join(wantToolNames, ",") {
			t.Fatalf("iter %d: dispatched tools %v, want %v", i, gotToolNames, wantToolNames)
		}

		// Token sum: one chat per Chat call, each carrying tokensPerCall.
		wantTokens := client.callCount() * tokensPerCall
		if res.Log.TotalTokens() != wantTokens {
			t.Fatalf("iter %d: log TotalTokens=%d, want %d", i, res.Log.TotalTokens(), wantTokens)
		}
		if res.TotalTokens != wantTokens {
			t.Fatalf("iter %d: result TotalTokens=%d, want %d", i, res.TotalTokens, wantTokens)
		}
	}
}

// registryDispatch is a tiny test helper that dispatches a single tool call
// against a runState using the same registry the runner uses, so tool-level
// property tests exercise the real handlers.
func (st *runState) registryDispatch(call toolCall) toolResult {
	return buildRegistry().dispatch(st, call)
}
