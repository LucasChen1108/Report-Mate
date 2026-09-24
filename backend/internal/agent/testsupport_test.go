package agent

// Shared test support for the agent package: a scripted chatClient mock (so no
// test ever fires a live gateway call — the cost-discipline rule in the tech
// steering) plus small builders for schemas and content.
//
// NOTE ON THE PROPERTY-TEST ENGINE: the ai-agent spec names pgregory.me/rapid
// for the property tests. That module cannot be fetched in this build
// environment (its import host does not resolve here), so the property tests in
// this package are driven by the standard library's testing/quick instead. The
// PROPERTIES asserted, their tags, and the >=100 iterations per property are
// exactly as the spec defines; only the randomization engine differs. Each
// property test documents this at its call site.

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/LucasChen1108/Report-Mate/backend/internal/reports"
	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// scriptedClient is a chatClient whose Chat returns pre-scripted replies in
// order, one per call. It records every call (message transcript + a spy count)
// so a test can assert how many times the gateway was contacted and with what.
// When the script is exhausted it returns the fallback reply (default: a
// save_draft, so a loop always terminates) unless err is set.
type scriptedClient struct {
	// replies are returned in order, one per Chat call. Each is the raw
	// assistant message content the runner will parse as a tool call.
	replies []string
	// fallback is returned once replies is exhausted. Defaults to a save_draft
	// tool call so a runaway loop still terminates deterministically.
	fallback string
	// err, when non-nil, is returned by every Chat call instead of a reply —
	// used to simulate a gateway/transport failure.
	err error
	// tokensPerCall is the total_tokens reported for each successful call.
	tokensPerCall int

	// calls records the transcript passed to each Chat invocation, in order.
	calls [][]chatMessage
}

// Chat implements chatClient. It records the call, then returns the next
// scripted reply (or the fallback), or the configured error.
func (c *scriptedClient) Chat(_ context.Context, messages []chatMessage) (chatResult, error) {
	// Deep-enough copy of the transcript for the spy: the runner reuses/append
	// to its slice, so snapshot the current contents.
	snapshot := make([]chatMessage, len(messages))
	copy(snapshot, messages)
	c.calls = append(c.calls, snapshot)

	if c.err != nil {
		return chatResult{}, c.err
	}

	n := len(c.calls) - 1
	content := c.fallback
	if content == "" {
		content = `{"tool":"save_draft"}`
	}
	if n < len(c.replies) {
		content = c.replies[n]
	}
	return chatResult{Content: content, TotalTokens: c.tokensPerCall}, nil
}

// callCount reports how many times Chat was invoked (the gateway-call spy).
func (c *scriptedClient) callCount() int { return len(c.calls) }

// --- Persist spies ----------------------------------------------------------

// recordingPersist is a persistFunc that records the content it was asked to
// persist and how many times, without any database. Used by pure-logic runner
// tests to assert save behavior in isolation.
type recordingPersist struct {
	calls    int
	last     reports.ReportContent
	returnErr error
}

func (p *recordingPersist) fn() persistFunc {
	return func(_ context.Context, content reports.ReportContent) error {
		p.calls++
		p.last = content
		return p.returnErr
	}
}

// --- Content helpers --------------------------------------------------------

// emptyContent returns a ReportContent with an initialized, empty Values map
// and no parts — the starting point for a fresh draft in tests.
func emptyContent() reports.ReportContent {
	return reports.ReportContent{
		Values:   map[string]json.RawMessage{},
		Parts:    []reports.PartRow{},
		FilledBy: reports.FilledByManual,
	}
}

// jsonRaw marshals v to json.RawMessage for seeding content values in tests.
func jsonRaw(t *testing.T, v any) json.RawMessage {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal test value: %v", err)
	}
	return json.RawMessage(b)
}

// --- Schema builders --------------------------------------------------------

// field is a compact constructor for a template Field in tests.
func field(id string, typ templates.FieldType, required bool, options ...string) templates.Field {
	return templates.Field{
		ID:       id,
		Label:    id + " label",
		Type:     typ,
		Required: required,
		Options:  options,
	}
}

// schemaOf wraps sections into a version-1 TemplateSchema.
func schemaOf(sections ...templates.Section) templates.TemplateSchema {
	return templates.TemplateSchema{Version: 1, Sections: sections}
}

// section wraps fields into a Section with a derived id/label.
func section(id string, fields ...templates.Field) templates.Section {
	return templates.Section{ID: id, Label: id + " label", Fields: fields}
}

// runStateFor builds a runState over a schema with empty content and the empty
// context providers, for tool-level tests. The returned content pointer is what
// fill_field mutates; the caller inspects it after dispatch.
func runStateFor(schema templates.TemplateSchema) (*runState, *reports.ReportContent) {
	content := emptyContent()
	st := &runState{
		schema:  schema,
		content: &content,
		jobs:    EmptyJobHistory{},
		parts:   EmptyPartsCatalog{},
		flagged: make(map[string]struct{}),
		log:     &RunLog{},
	}
	return st, &content
}
