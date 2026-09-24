package agent

import (
	"errors"
	"fmt"
	"strings"

	"github.com/LucasChen1108/Report-Mate/backend/internal/reports"
)

// maxMessageLen is the upper bound on a single Conversation_Message's content,
// after trimming surrounding whitespace (Req 1.6, 9.1). A technician's account
// or answer longer than this is rejected as a validation error before any
// gateway call is made.
const maxMessageLen = 10000

// ConversationMessage is one entry in the client-carried conversation
// transcript. Role is "technician" | "agent"; Content is 1..10000 chars
// (validated by validateTranscript). The technician's first message is the
// free-text account; a later technician message is an answer to an
// Agent_Question, and an agent message is a clarifying question the agent asked
// on a prior turn.
type ConversationMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

// agentChatRequest is the POST /api/reports/{id}/agent-chat body: the running
// transcript the frontend holds and re-sends on every Conversation_Turn
// (client-carried state, no database read).
type agentChatRequest struct {
	Messages []ConversationMessage `json:"messages"`
}

// agentChatResponse is the Agent_Endpoint's per-turn response. It NEVER carries
// the gateway key (Req 10.2): the key lives only in backend configuration and
// is never serialized here or anywhere reachable by the frontend. Messages is
// the grown transcript the client sends back next turn; Report is the reloaded
// draft; the remaining fields report the turn's outcome and the
// transcript-derived usage counts.
type agentChatResponse struct {
	Messages        []ConversationMessage `json:"messages"`
	Report          reports.ReportRecord  `json:"report"`
	FlaggedFieldIDs []string              `json:"flaggedFieldIds"`
	AwaitingAnswer  bool                  `json:"awaitingAnswer"`
	TerminatedBy    string                `json:"terminatedBy"`
	TokenUsage      int                   `json:"tokenUsage"`
	TurnsUsed       int                   `json:"turnsUsed"`
	QuestionsUsed   int                   `json:"questionsUsed"`
}

// validateTranscript checks that messages form a resumable conversation the
// agent can run one more turn on, returning a descriptive error the handler
// maps to 422 (no gateway call, no draft change — Req 1.6). It enforces:
//
//   - the transcript is non-empty;
//   - every role is one of "technician" | "agent";
//   - every content, after trimming whitespace, is 1..10000 chars (Req 1.6,
//     9.1);
//   - the first message is a technician message;
//   - every agent message is preceded by a technician message;
//   - the last message is a technician message — a turn only runs on the
//     technician's move, either the opening account or an answer to the agent's
//     question (Req 1.4, 3.3).
//
// It returns nil when the transcript is valid.
func validateTranscript(messages []ConversationMessage) error {
	if len(messages) == 0 {
		return errors.New("conversation transcript is empty; at least the technician's account is required")
	}

	sawTechnician := false
	for i, m := range messages {
		if m.Role != "technician" && m.Role != "agent" {
			return fmt.Errorf("message %d has invalid role %q; role must be \"technician\" or \"agent\"", i, m.Role)
		}

		trimmedLen := len(strings.TrimSpace(m.Content))
		if trimmedLen < 1 {
			return fmt.Errorf("message %d (%s) is empty or whitespace-only; content must be 1 to %d characters", i, m.Role, maxMessageLen)
		}
		if trimmedLen > maxMessageLen {
			return fmt.Errorf("message %d (%s) is %d characters; content must be 1 to %d characters", i, m.Role, trimmedLen, maxMessageLen)
		}

		if m.Role == "technician" {
			sawTechnician = true
			continue
		}

		// m.Role == "agent"
		if !sawTechnician {
			return fmt.Errorf("message %d is an agent message not preceded by any technician message; the transcript must be technician-first", i)
		}
	}

	if messages[0].Role != "technician" {
		return errors.New("the first message must be a technician message (the free-text account)")
	}

	if messages[len(messages)-1].Role != "technician" {
		return errors.New("the last message must be a technician message; a turn only runs on the technician's move (their account or their answer)")
	}

	return nil
}

// questionsUsed counts the Agent_Questions already in the transcript: the number
// of agent-role messages, since each agent message ended a prior turn with a
// question (Req 4.2).
func questionsUsed(messages []ConversationMessage) int {
	n := 0
	for _, m := range messages {
		if m.Role == "agent" {
			n++
		}
	}
	return n
}

// turnsUsed counts the completed Conversation_Turns implied by the transcript.
// A turn that did not end the conversation ended by asking a question, i.e. by
// appending exactly one agent message; a turn that ended terminally (save_draft,
// cap, error) produces no further request, so it never appears as a later turn.
// One agent message therefore corresponds to one completed, paused turn, so
// turnsUsed == questionsUsed.
//
// The turn ABOUT to run is not counted here; it is bounded by enforcing
// turnsUsed >= turnCap BEFORE running the turn (Req 4.1, 4.4).
func turnsUsed(messages []ConversationMessage) int {
	return questionsUsed(messages)
}
