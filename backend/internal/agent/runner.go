package agent

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/reports"
	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// toolCall is one parsed model instruction. The model replies with a single
// JSON object of this shape; the runner parses it (via parseToolCall) and
// dispatches to the named tool.
//
// Only the fields relevant to a given tool are populated:
//   - get_template_schema / get_parts_catalog / save_draft carry only "tool".
//   - get_job_history carries an optional "job_id".
//   - fill_field / flag_missing_field carry "field_id"; fill_field also carries
//     "value", whose JSON shape depends on the target field's type (string,
//     number, or array of strings), so it is held as a raw message and decoded
//     by the fill_field handler.
type toolCall struct {
	Tool     string          `json:"tool"`
	FieldID  string          `json:"field_id,omitempty"`
	Value    json.RawMessage `json:"value,omitempty"`
	JobID    string          `json:"job_id,omitempty"`
	Question string          `json:"question,omitempty"` // ask_technician
}

// stripCodeFences removes a surrounding Markdown code fence from s and returns
// the inner text trimmed. The model is instructed to reply with ONLY a JSON
// object, but it commonly wraps that object in a ```json ... ``` (or bare
// ``` ... ```) fence. This handles that wrapper, including an optional language
// tag after the opening fence.
//
// It is a no-op on bare JSON: if the trimmed input does not both open with a
// fence and close with one, the trimmed input is returned unchanged.
func stripCodeFences(s string) string {
	trimmed := strings.TrimSpace(s)

	// Must open with a fence and be long enough to also carry a closing fence.
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}

	// Drop the opening fence and any language tag on the same line (e.g.
	// "```json"). The first newline separates the fence line from the body.
	rest := trimmed[len("```"):]
	newline := strings.IndexByte(rest, '\n')
	if newline < 0 {
		// A single ```... token with no body/closing fence: not a real fence
		// wrapper, leave the trimmed input unchanged.
		return trimmed
	}
	// Anything on the opening fence line is a language tag; discard it.
	body := rest[newline+1:]

	// Must close with a fence to be a wrapper.
	closeIdx := strings.LastIndex(body, "```")
	if closeIdx < 0 {
		return trimmed
	}
	body = body[:closeIdx]

	return strings.TrimSpace(body)
}

// parseToolCall strips any surrounding code fence from content and unmarshals
// the result into a toolCall. It returns an error when the content is not a
// single JSON object (e.g. prose, a JSON array, or a bare scalar) or when the
// decoded object has no "tool" field. Rejecting these here means the runner
// terminates the run rather than dispatching an undefined tool (Req 6.5).
func parseToolCall(content string) (toolCall, error) {
	stripped := stripCodeFences(content)
	if stripped == "" {
		return toolCall{}, errors.New("agent: empty assistant message, expected a JSON tool call")
	}

	// Reject anything that is not a JSON object. Unmarshaling directly into a
	// struct would silently accept arrays/scalars in some cases, so decode into
	// json.RawMessage first and require an object.
	var raw json.RawMessage
	if err := json.Unmarshal([]byte(stripped), &raw); err != nil {
		return toolCall{}, errors.New("agent: assistant message is not valid JSON")
	}
	if trimmed := strings.TrimSpace(string(raw)); len(trimmed) == 0 || trimmed[0] != '{' {
		return toolCall{}, errors.New("agent: assistant message is not a single JSON object")
	}

	var call toolCall
	if err := json.Unmarshal(raw, &call); err != nil {
		return toolCall{}, errors.New("agent: assistant message is not a valid tool call")
	}
	if strings.TrimSpace(call.Tool) == "" {
		return toolCall{}, errors.New("agent: tool call is missing a \"tool\" field")
	}

	return call, nil
}

// chatClient is the seam the runner depends on for gateway calls. gatewayClient
// satisfies it; tests inject a scripted mock so a run never fires a live call.
type chatClient interface {
	Chat(ctx context.Context, messages []chatMessage) (chatResult, error)
}

// persistFunc persists the agent's in-memory content copy for a report. The
// endpoint supplies it (tasks 10.1/11.1); on a save_draft tool call the runner
// calls it exactly once. A validation error (unknown field id, bad type) from
// the reports write path propagates back and terminates the run WITHOUT a
// partial write, so a run that fails before or at save_draft leaves the
// persisted draft untouched (Req 9.3).
type persistFunc func(ctx context.Context, content reports.ReportContent) error

// Runner default budgets, from Req 6.6 (iteration cap) and Req 9.2 (overall
// timeout).
const (
	defaultMaxIters = 10               // Req 6.6
	defaultOverall  = 60 * time.Second // Req 9.2
)

// Runner executes one agent run against one draft. It owns the tool-calling
// loop, the message accumulation, and the RunLog. It NEVER persists anything
// except through the injected persistFunc on a save_draft tool call, and it
// mutates only an in-memory copy of the draft content — so a failed run leaves
// the persisted draft untouched (Req 9.3).
type Runner struct {
	client   chatClient
	registry *toolRegistry
	maxIters int           // 10 (Req 6.6)
	overall  time.Duration // 60s overall budget (Req 9.2)
}

// NewRunner builds a Runner over the given chat client with the default budgets
// (maxIters=10, overall=60s) and the full tool registry (fill_field plus the
// four context/flag tools; save_draft is intercepted by the loop, not
// registered). The caller supplies the providers and the persist closure per
// run through RunInput and Run's persist argument, so one Runner can serve many
// requests.
func NewRunner(client chatClient) *Runner {
	return &Runner{
		client:   client,
		registry: buildRegistry(),
		maxIters: defaultMaxIters,
		overall:  defaultOverall,
	}
}

// RunInput is everything one run needs. Content is a COPY of the draft's
// current content; the runner mutates it in memory and persists it only via
// persist on save_draft. Jobs/Parts are the context providers backing
// get_job_history / get_parts_catalog (EmptyJobHistory / EmptyPartsCatalog
// today, real implementations when the data lands).
type RunInput struct {
	ReportID string
	Schema   templates.TemplateSchema // the draft's schema SNAPSHOT
	Content  reports.ReportContent    // a COPY of current draft content
	JobID    *string
	Messages []ConversationMessage // full prior transcript; last is the technician's move
	Jobs     JobHistoryProvider
	Parts    PartsCatalogProvider

	// QuestionsRemaining is questionCap - questionsUsed for this turn. When it
	// is zero or negative the agent may ask no further questions: the system
	// prompt says so and the runner rejects any ask_technician this turn.
	QuestionsRemaining int
}

// RunResult is the outcome of a run. Content is the mutated in-memory copy; it
// is persisted only when Saved is true. TerminatedBy is one of "save_draft",
// "iteration_cap", "parse_failure", "gateway_error", or "timeout".
type RunResult struct {
	Content         reports.ReportContent
	FlaggedFieldIDs []string
	TotalTokens     int
	TerminatedBy    string
	Saved           bool
	// AwaitingAnswer is true when the turn ended by emitting a valid
	// ask_technician question (TerminatedBy == "ask_technician").
	AwaitingAnswer bool
	// Question is the validated, trimmed question text, set only when
	// AwaitingAnswer is true.
	Question string
	// Filled is true when any fill_field succeeded during this turn. It is
	// cumulative across the loop and drives the handler's turn-end persist for a
	// paused or cap-terminated turn.
	Filled bool
	Log    *RunLog
}

// Run executes the hand-rolled JSON tool-calling loop for one draft (design
// section 3). It applies the 60s overall budget, builds the system + user
// messages once, then loops up to maxIters times: prompt the gateway, log the
// chat and accumulate tokens, append the assistant reply, parse the tool call,
// and either terminate (save_draft / parse failure) or dispatch through the
// registry and feed the tool result back as the next message.
//
// Termination and the (result, error) contract, per the design's error map:
//   - gateway error / timeout: returns a non-nil error (a wrapped
//     errGatewayUnavailable from the client, or the ctx deadline error) so the
//     endpoint maps it to 503; TerminatedBy is "gateway_error" or "timeout" and
//     Saved is false. Nothing was persisted.
//   - parse failure: returns nil error with TerminatedBy="parse_failure",
//     Saved=false — the endpoint returns 200 with the unchanged draft, because
//     save_draft never ran (Req 6.5, 9.3).
//   - iteration cap: returns nil error with TerminatedBy="iteration_cap",
//     Saved=false — same unchanged-draft outcome (Req 6.6).
//   - save_draft: calls persist once. A persist error (e.g. a validation error)
//     is returned so the endpoint can map it (e.g. 422), with Saved=false and
//     nothing persisted. On success: TerminatedBy="save_draft", Saved=true, and
//     the flagged ids collected.
func (r *Runner) Run(ctx context.Context, in RunInput, persist persistFunc) (RunResult, error) {
	// 1. Apply the overall budget so a run can never outlive it (Req 9.2).
	ctx, cancel := context.WithTimeout(ctx, r.overall)
	defer cancel()

	log := &RunLog{}

	// The runner mutates an in-memory copy of the content; deep-copy the Values
	// map so writes never touch the caller's original (Req 9.3).
	content := copyContent(in.Content)

	st := &runState{
		schema:  in.Schema,
		content: &content,
		jobID:   in.JobID,
		jobs:    in.Jobs,
		parts:   in.Parts,
		flagged: make(map[string]struct{}),
		log:     log,
	}

	// 2. Build the initial transcript deterministically from the conversation
	// messages the client sent: the system prompt (which states this turn's
	// remaining question budget), then every ConversationMessage in order,
	// mapping technician->user and agent->assistant so the model sees its own
	// prior questions and the technician's answers. The loop appends the
	// assistant reply and each tool result as it goes.
	messages := []chatMessage{
		{Role: "system", Content: buildSystemPrompt(in.Schema, in.QuestionsRemaining)},
	}
	for _, m := range in.Messages {
		switch m.Role {
		case "agent":
			messages = append(messages, chatMessage{Role: "assistant", Content: m.Content})
		default: // "technician"
			messages = append(messages, chatMessage{Role: "user", Content: m.Content})
		}
	}

	result := RunResult{Log: log}

	// 3. Loop up to maxIters times (Req 6.6).
	for i := 0; i < r.maxIters; i++ {
		// a. Prompt the gateway.
		res, err := r.client.Chat(ctx, messages)
		if err != nil {
			// A deadline exceeded on our overall budget is a timeout; anything
			// else is a gateway error. Either way nothing was persisted.
			note := "gateway_error"
			if ctx.Err() == context.DeadlineExceeded {
				note = "timeout"
			}
			log.Terminate(note)
			result.TerminatedBy = note
			result.Content = content
			result.TotalTokens = log.TotalTokens()
			result.Saved = false
			// result.Filled is cumulative; leave whatever prior fills set.
			return result, err
		}

		// b. Log the chat and accumulate tokens (Req 8.2).
		log.Chat(res.TotalTokens)
		result.TotalTokens += res.TotalTokens

		// c. Append the assistant reply so the next prompt carries it.
		messages = append(messages, chatMessage{Role: "assistant", Content: res.Content})

		// d. Parse the tool call. A parse failure terminates the run without
		// dispatching an undefined tool (Req 6.5); no error is returned because
		// save_draft never ran, so the draft is simply unchanged.
		call, perr := parseToolCall(res.Content)
		if perr != nil {
			log.Terminate("parse_failure")
			result.TerminatedBy = "parse_failure"
			result.Content = content
			result.FlaggedFieldIDs = flaggedIDs(st.flagged)
			result.Saved = false
			return result, nil
		}

		// e. save_draft is intercepted here rather than dispatched through the
		// registry: it terminates the loop and persists the in-memory copy once.
		if call.Tool == "save_draft" {
			if err := persist(ctx, *st.content); err != nil {
				// A validation error leaves the stored draft untouched; surface
				// it so the endpoint can map it (e.g. 422).
				log.Terminate("save_draft_error")
				result.TerminatedBy = "save_draft"
				result.Content = *st.content
				result.FlaggedFieldIDs = flaggedIDs(st.flagged)
				result.Saved = false
				return result, err
			}
			log.Terminate("save_draft")
			result.TerminatedBy = "save_draft"
			result.Content = *st.content
			result.FlaggedFieldIDs = flaggedIDs(st.flagged)
			result.Saved = true
			return result, nil
		}

		// e2. ask_technician is intercepted here rather than dispatched through
		// the registry. A VALID question pauses the turn: the loop stops without
		// emitting save_draft (Req 2.2) and the handler persists any accumulated
		// fills at turn end (task 6.2). An INVALID question (empty/whitespace,
		// over 500 chars, or asked when no questions remain this turn) is
		// rejected, logged, and the loop CONTINUES so the model can choose
		// another action (Req 2.5, 4.5).
		if call.Tool == "ask_technician" {
			q := strings.TrimSpace(call.Question)
			args := askArgs(call)

			var detail string
			switch {
			case q == "":
				detail = "question is empty or whitespace-only; ask a single question of 1 to 500 characters"
			case len(q) > 500:
				detail = "question exceeds 500 characters; ask a single question of 1 to 500 characters"
			case in.QuestionsRemaining <= 0:
				detail = "no questions remaining this report; flag any required fields you cannot fill, then save_draft"
			}

			if detail != "" {
				// Reject: log it and feed the rejection back like any other tool
				// result, then continue the loop (no pause).
				rejected := toolResult{Ok: false, Detail: detail}
				logTool(st, "ask_technician", args, rejected)
				encoded, _ := json.Marshal(rejected)
				messages = append(messages, chatMessage{Role: "user", Content: "TOOL RESULT: " + string(encoded)})
				continue
			}

			// Valid question: pause the turn. Do NOT emit save_draft and do NOT
			// persist here — the handler persists the accumulated fills at turn
			// end (task 6.2). result.Filled reflects whether any fill happened.
			log.Terminate("ask_technician")
			result.TerminatedBy = "ask_technician"
			result.AwaitingAnswer = true
			result.Question = q
			result.Content = *st.content
			result.FlaggedFieldIDs = flaggedIDs(st.flagged)
			result.Saved = false
			return result, nil
		}

		// f. Any other tool: dispatch through the registry (the handler logs
		// itself), then feed the tool result back as a message for the next
		// prompt so the model sees the outcome of its call.
		//
		// The result is fed back as a Role:"user" message, NOT Role:"tool".
		// This gateway is Bedrock-backed and treats role:"tool" as a native
		// Bedrock toolResult content block, rejecting the request with HTTP 400
		// ("The toolConfig field must be defined when using toolUse and
		// toolResult content blocks") because we deliberately do NOT use native
		// tool-calling — the whole loop is manual JSON tool-calling. A plain
		// user message carrying the tool result as text works, and the model
		// correctly continues emitting the next JSON tool call. The "TOOL
		// RESULT:" prefix keeps it unambiguous to the model that this user
		// message is the outcome of its previous call.
		toolRes := r.registry.dispatch(st, call)
		if call.Tool == "fill_field" && toolRes.Ok {
			// A successful fill means the turn produced content worth persisting
			// even if it later pauses or hits the iteration cap (Req 5.x). Filled
			// is cumulative: once true it stays true for the rest of the turn.
			result.Filled = true
		}
		encoded, _ := json.Marshal(toolRes)
		messages = append(messages, chatMessage{Role: "user", Content: "TOOL RESULT: " + string(encoded)})
	}

	// 4. Fell through maxIters without a save_draft (Req 6.6). Nothing was
	// persisted; the draft keeps its pre-run content.
	log.Terminate("iteration_cap")
	result.TerminatedBy = "iteration_cap"
	result.Content = content
	result.FlaggedFieldIDs = flaggedIDs(st.flagged)
	result.Saved = false
	return result, nil
}

// copyContent returns a copy of c whose Values map and Parts slice are fresh, so
// fill_field writes into st.content never mutate the caller's original content
// (the atomicity guarantee for a failed run, Req 9.3). The json.RawMessage
// values themselves are treated as immutable — fill_field replaces map entries
// rather than editing bytes in place — so a shallow copy of each value suffices.
func copyContent(c reports.ReportContent) reports.ReportContent {
	out := reports.ReportContent{FilledBy: c.FilledBy}
	if c.Values != nil {
		out.Values = make(map[string]json.RawMessage, len(c.Values))
		for k, v := range c.Values {
			out.Values[k] = v
		}
	}
	if c.Parts != nil {
		out.Parts = make([]reports.PartRow, len(c.Parts))
		copy(out.Parts, c.Parts)
	}
	return out
}

// flaggedIDs returns the flagged field ids as a sorted slice, so a run's
// FlaggedFieldIDs are deterministic regardless of map iteration order (Req 3.2).
// It returns a non-nil empty slice when nothing was flagged.
func flaggedIDs(flagged map[string]struct{}) []string {
	ids := make([]string, 0, len(flagged))
	for id := range flagged {
		ids = append(ids, id)
	}
	sort.Strings(ids)
	return ids
}
