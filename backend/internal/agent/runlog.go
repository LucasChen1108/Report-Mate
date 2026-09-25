package agent

import "encoding/json"

// RunLogEntry is one ordered record in a run: either a gateway call's token
// usage, a dispatched tool call and its result, or a terminal event.
//
// The entry only ever holds token counts, tool arguments, tool results, and
// notes — it never carries the gateway key.
type RunLogEntry struct {
	Seq         int             `json:"seq"`                   // 0-based order
	Kind        string          `json:"kind"`                  // "chat" | "tool" | "terminate"
	Tool        string          `json:"tool,omitempty"`        // tool name for kind=tool
	Args        json.RawMessage `json:"args,omitempty"`        // tool arguments as received
	Result      json.RawMessage `json:"result,omitempty"`      // toolResult, JSON-encoded
	TotalTokens int             `json:"totalTokens,omitempty"` // usage.total_tokens for kind=chat
	Note        string          `json:"note,omitempty"`        // e.g. "parse_failure", "iteration_cap"
}

// RunLog is the ordered, in-memory log for one agent run. It is append-only
// with a sequential Seq starting at 0, preserves dispatch order, and never
// holds the gateway key.
type RunLog struct {
	Entries []RunLogEntry
}

// Chat appends a kind="chat" entry recording the token usage reported by the
// gateway for one chat completion (Req 8.2).
func (l *RunLog) Chat(totalTokens int) {
	l.append(RunLogEntry{
		Kind:        "chat",
		TotalTokens: totalTokens,
	})
}

// Tool appends a kind="tool" entry recording one dispatched tool call, its
// arguments as received, and its result (Req 8.1, 8.3).
func (l *RunLog) Tool(tool string, args, result json.RawMessage) {
	l.append(RunLogEntry{
		Kind:   "tool",
		Tool:   tool,
		Args:   args,
		Result: result,
	})
}

// Terminate appends a kind="terminate" entry recording the terminal event
// (e.g. "save_draft", "parse_failure", "iteration_cap", "gateway_error",
// "timeout").
func (l *RunLog) Terminate(note string) {
	l.append(RunLogEntry{
		Kind: "terminate",
		Note: note,
	})
}

// TotalTokens sums the reported token usage across all kind="chat" entries
// (Req 8.2).
func (l *RunLog) TotalTokens() int {
	total := 0
	for _, e := range l.Entries {
		if e.Kind == "chat" {
			total += e.TotalTokens
		}
	}
	return total
}

// append assigns the next sequential Seq and appends the entry, keeping the
// log append-only and ordered.
func (l *RunLog) append(e RunLogEntry) {
	e.Seq = len(l.Entries)
	l.Entries = append(l.Entries, e)
}
