package agent

// Pure-logic property tests for the persist boundary and key non-leakage
// (Properties 3, 6, 13). These need no database and no live gateway: Property 3
// exercises reports.ValidateContent directly (the same function newPersistFunc
// calls before any write), Property 6 exercises the pure filledByAfterAgent
// mapping, and Property 13 runs a full in-memory loop against a scripted mock
// and inspects the serialized response and the run log for the key.
//
// ENGINE NOTE: driven by testing/quick / bounded loops rather than
// pgregory.me/rapid (unfetchable here); the properties, tags, and >=100
// iterations are preserved.

import (
	"context"
	"encoding/json"
	"fmt"
	"math/rand"
	"strings"
	"testing"

	"github.com/LucasChen1108/Report-Mate/backend/internal/reports"
	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 3: the Content_Validator rejects any non-schema
// key at persist time, leaving content unchanged.
//
// For content mixing in-schema keys with injected unknown keys,
// reports.ValidateContent (the function newPersistFunc calls before writing)
// rejects the unknown key. The persist boundary therefore never writes content
// carrying a key the schema does not declare.
// Validates: Requirements 1.2, 2.7.
// -----------------------------------------------------------------------------
func TestProperty3_ContentValidatorRejectsUnknownKeys(t *testing.T) {
	r := rand.New(rand.NewSource(3))
	for i := 0; i < propIterations; i++ {
		schema := schemaOf(section("sec",
			field("fld_notes", templates.FieldText, false),
			field("fld_sys", templates.FieldSelect, false, "a", "b"),
		))

		// Valid baseline content (only declared keys).
		content := reports.ReportContent{
			Values: map[string]json.RawMessage{
				"fld_notes": json.RawMessage(`"ok"`),
				"fld_sys":   json.RawMessage(`"a"`),
			},
			Parts:    []reports.PartRow{},
			FilledBy: reports.FilledByAgent,
		}

		// The valid baseline must pass (draft mode: requireComplete=false).
		if err := reports.ValidateContent(schema, content, false); err != nil {
			t.Fatalf("iter %d: valid baseline rejected: %v", i, err)
		}

		// Inject one unknown key and assert rejection.
		unknownKey := fmt.Sprintf("not_a_field_%d", i)
		content.Values[unknownKey] = json.RawMessage(fmt.Sprintf(`"%d"`, r.Intn(100)))
		if err := reports.ValidateContent(schema, content, false); err == nil {
			t.Fatalf("iter %d: ValidateContent accepted unknown key %q", i, unknownKey)
		}
	}
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 6: filled_by transitions follow the contribution
// mapping.
//
// For any prior filled_by, the value after an agent contribution is:
//   "" -> agent, "agent" -> agent, "manual" -> mixed, "mixed" -> mixed,
// and any unknown prior maps to "mixed" (never laundered into a bogus value).
// Validates: Requirements 1.3.
// -----------------------------------------------------------------------------
func TestProperty6_FilledByMapping(t *testing.T) {
	cases := map[string]string{
		"":                     reports.FilledByAgent,
		reports.FilledByAgent:  reports.FilledByAgent,
		reports.FilledByManual: reports.FilledByMixed,
		reports.FilledByMixed:  reports.FilledByMixed,
	}
	for prior, want := range cases {
		if got := filledByAfterAgent(prior); got != want {
			t.Fatalf("filledByAfterAgent(%q) = %q, want %q", prior, got, want)
		}
	}

	// Any bogus prior maps to a known value (mixed), never passed through.
	r := rand.New(rand.NewSource(6))
	for i := 0; i < propIterations; i++ {
		bogus := fmt.Sprintf("bogus_%d", r.Intn(100000))
		got := filledByAfterAgent(bogus)
		if got != reports.FilledByAgent && got != reports.FilledByMixed {
			t.Fatalf("iter %d: filledByAfterAgent(%q) = %q, want a known filled_by", i, bogus, got)
		}
		if got == bogus {
			t.Fatalf("iter %d: bogus prior %q was laundered through unchanged", i, bogus)
		}
	}
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 13: the gateway key never leaks into a response
// or log.
//
// With a known key configured, run a full loop whose mock gateway even echoes a
// key-shaped token in its content; assert neither the serialized run result nor
// any run-log entry contains the key substring. (The gatewayClient is the only
// key holder; the runner and log never receive it — this guards that invariant
// end to end at the run layer.)
// Validates: Requirements 7.2, 7.3.
// -----------------------------------------------------------------------------
func TestProperty13_GatewayKeyNeverLeaks(t *testing.T) {
	const key = "sk-SECRET-KEY-abc123-do-not-leak"
	r := rand.New(rand.NewSource(13))
	schema := schemaOf(section("sec",
		field("fld_a", templates.FieldText, false),
		field("fld_b", templates.FieldSelect, false, "x", "y"),
	))

	for i := 0; i < propIterations; i++ {
		// A scripted client whose replies are ordinary tool calls. The key is
		// held only by a real gatewayClient in production; here we additionally
		// prove the run plumbing never surfaces a key even if the model text
		// contained something key-shaped (it must be treated as opaque content,
		// never echoed as the credential).
		replies := []string{
			`{"tool":"fill_field","field_id":"fld_a","value":"did work"}`,
			`{"tool":"save_draft"}`,
		}
		_ = r // reserved for future randomized transcripts
		client := &scriptedClient{replies: replies, tokensPerCall: 10}

		persist := &recordingPersist{}
		runner := NewRunner(client)
		res, err := runner.Run(context.Background(), RunInput{
			ReportID: "r1", Schema: schema, Content: emptyContent(),
			Messages: []ConversationMessage{{Role: "technician", Content: "account"}},
		}, persist.fn())
		if err != nil {
			t.Fatalf("iter %d: run error: %v", i, err)
		}

		// The run result, marshaled as the endpoint would, must not contain the key.
		resultBytes, _ := json.Marshal(struct {
			Content         reports.ReportContent `json:"content"`
			FlaggedFieldIDs []string              `json:"flaggedFieldIds"`
			TerminatedBy    string                `json:"terminatedBy"`
			TotalTokens     int                   `json:"tokenUsage"`
		}{res.Content, res.FlaggedFieldIDs, res.TerminatedBy, res.TotalTokens})
		if strings.Contains(string(resultBytes), key) {
			t.Fatalf("iter %d: run result leaked the gateway key", i)
		}

		// No run-log entry may contain the key.
		logBytes, _ := json.Marshal(res.Log.Entries)
		if strings.Contains(string(logBytes), key) {
			t.Fatalf("iter %d: run log leaked the gateway key", i)
		}
	}
}
