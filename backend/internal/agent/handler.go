package agent

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
	"github.com/LucasChen1108/Report-Mate/backend/internal/reports"
	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// maxAccountLen is the upper bound on the technician's free-text account
// (Req 1.4). An account longer than this is rejected as a validation error
// before any gateway call is made.
const maxAccountLen = 10000

// technicianRole is the role scoped to its own reports; any other authenticated
// role may reach every report. It mirrors reports.technicianRole (unexported
// there) and the users.role CHECK constraint in 0001_users.sql.
const technicianRole = "technician"

// Handler serves the Agent_Endpoint route (POST /api/reports/{id}/agent-fill).
// It reuses the reports store to load and persist drafts and holds the runner's
// dependencies. client is nil when the gateway is unconfigured, in which case
// the endpoint answers 503 without running a loop (Req 9.1).
type Handler struct {
	store  *reports.Store
	client chatClient // nil when the gateway is unconfigured
	jobs   JobHistoryProvider
	parts  PartsCatalogProvider

	// turnCap bounds the number of completed conversation turns a chat can
	// carry before the agent refuses to run another turn; questionCap bounds the
	// number of clarifying questions across a chat. Both are derived from config
	// (task 7.1 wires cfg values in) and defended below so the handler is safe
	// even if a caller passes a non-positive value.
	turnCap     int
	questionCap int
}

// defaultTurnCap / defaultQuestionCap are the handler-local fallbacks applied
// when a non-positive cap is passed in. Config already resolves sane values
// (task 1.1), so these are purely defensive — they keep the endpoint from
// derailing (e.g. a zero turnCap would refuse every turn) if construction is
// ever fed a bad value.
const (
	defaultTurnCap     = 6
	defaultQuestionCap = 4
)

// NewHandler composes the agent handler over db, the (possibly nil) gateway
// client, and the two context providers. When client is nil the endpoint
// answers 503 without dialling out, so the manual fill path keeps working with
// no gateway configured (Req 9.1). turnCap/questionCap bound the conversation
// endpoint; a non-positive value falls back to the package default.
func NewHandler(db *sql.DB, client chatClient, jobs JobHistoryProvider, parts PartsCatalogProvider, turnCap, questionCap int) *Handler {
	if turnCap <= 0 {
		turnCap = defaultTurnCap
	}
	if questionCap <= 0 {
		questionCap = defaultQuestionCap
	}
	return &Handler{
		store:       reports.NewStore(db),
		client:      client,
		jobs:        jobs,
		parts:       parts,
		turnCap:     turnCap,
		questionCap: questionCap,
	}
}

// NewHandlerFromConfig composes the agent handler from raw gateway settings,
// deciding internally whether the gateway is configured. It exists because the
// chatClient interface is unexported: cmd/server cannot name it to build the
// typed-nil client itself, so it hands the URL/key/model here and lets the
// agent package own the nil handling.
//
// When both gatewayURL and apiKey are non-empty a *gatewayClient is built and
// used; otherwise the client is left nil (an interface holding no concrete
// value, so h.client == nil is true) and the endpoint answers 503 while the
// manual fill path keeps working (Req 9.1). The apiKey is never logged here.
func NewHandlerFromConfig(db *sql.DB, gatewayURL, apiKey, model string, jobs JobHistoryProvider, parts PartsCatalogProvider, turnCap, questionCap int) *Handler {
	var client chatClient
	if gatewayURL != "" && apiKey != "" {
		client = newGatewayClient(gatewayURL, apiKey, model)
	}
	return NewHandler(db, client, jobs, parts, turnCap, questionCap)
}

// RegisterRoutes mounts the agent route. The pattern is the FULL path even
// though cmd/server delegates the /api/reports subtree to this mux — ServeMux
// does not rewrite the path on the way through, so a trimmed pattern would
// match nothing. Mounting here (on the same reportsMux) inherits the 32 MB body
// limit and identity middleware cmd/server already wraps the reports subtree
// with.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/reports/{id}/agent-fill", h.handleAgentFill)
	mux.HandleFunc("POST /api/reports/{id}/agent-chat", h.handleAgentChat)
}

// agentFillRequest is the JSON body of POST /api/reports/{id}/agent-fill: the
// technician's free-text account of the visit.
type agentFillRequest struct {
	Account string `json:"account"`
}

// agentFillResponse mirrors the frontend api/agent.ts shape. It NEVER carries
// the gateway key (Req 7.2): only the persisted (or unchanged) draft, the
// flagged field ids to highlight, the token usage sum, and the terminate reason
// for UI messaging.
type agentFillResponse struct {
	Report          reports.ReportRecord `json:"report"`
	FlaggedFieldIDs []string             `json:"flaggedFieldIds"`
	TokenUsage      int                  `json:"tokenUsage"`
	TerminatedBy    string               `json:"terminatedBy"`
}

// loadOwnedDraft runs the guard ladder shared by handleAgentFill and
// handleAgentChat and returns the loaded, owned, editable draft. It is
// VALIDATION-FIRST and touches no gateway: every guard here answers before any
// LLM call, so an unauthenticated caller, an unknown/foreign report, or a
// non-draft report never spends a gateway credit.
//
// The guards, in order:
//  1. Identity — 401 when unauthenticated (Req 1.6).
//  2. Id shape / existence — 404 on a malformed or unknown id.
//  3. Ownership — 403 when a technician does not own the report (Req 1.6).
//  4. Status — 422 when the report is not a draft (Req 1.7).
//
// On any failure it writes the response and returns ok=false; the caller must
// return immediately. The per-endpoint input validation and the gateway-nil
// 503 check are deliberately NOT here — each endpoint runs them itself, after
// its own input validation, so a bad body is rejected before the gateway is
// even considered.
func (h *Handler) loadOwnedDraft(w http.ResponseWriter, r *http.Request) (reports.ReportRecord, bool) {
	ctx := r.Context()

	// 1. Identity: an unauthenticated request never falls back to a default
	// user. role decides whether ownership is enforced below.
	userID, ok := middleware.UserIDFromContext(ctx)
	if !ok || userID == "" {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthenticated", "authentication is required")
		return reports.ReportRecord{}, false
	}
	role, _ := middleware.RoleFromContext(ctx)

	// 2. Resolve and load the report. A malformed id cannot name a report, and
	// answering 404 keeps the response identical to an id that simply does not
	// exist (mirrors reports.loadOwned).
	id := r.PathValue("id")
	if !isUUID(id) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "report not found")
		return reports.ReportRecord{}, false
	}
	rec, err := h.store.Get(ctx, id)
	if err != nil {
		writeStoreError(w, err)
		return reports.ReportRecord{}, false
	}

	// 3. Ownership: a technician may only reach their own reports; any other
	// authenticated role may reach all of them.
	if role == technicianRole {
		if rec.TechnicianID == nil || *rec.TechnicianID != userID {
			httpx.WriteError(w, http.StatusForbidden, "authorization_error", "this report belongs to another technician")
			return reports.ReportRecord{}, false
		}
	}

	// 4. Only a draft is editable. A submitted/exported report is fixed
	// (Req 1.7); no gateway call.
	if rec.Status != reports.StatusDraft {
		httpx.WriteError(w, http.StatusUnprocessableEntity, httpx.ValidationCode, "report is not editable")
		return reports.ReportRecord{}, false
	}

	return rec, true
}

// handleAgentFill runs the agent against a draft. It is VALIDATION-FIRST:
// nothing dials the gateway until every guard passes (Req 1.4, 1.6, 1.7), so an
// unauthenticated caller, an unknown/foreign report, a non-draft report, or an
// invalid account never spends a gateway credit.
//
// The guards, in order:
//  1. Identity — 401 when unauthenticated (Req 1.6).       ┐
//  2. Id shape / existence — 404 on a malformed/unknown id. │ loadOwnedDraft
//  3. Ownership — 403 when a technician does not own it.    │ (shared with chat)
//  4. Status — 422 when the report is not a draft (Req 1.7).┘
//  5. Account — 422 when empty/whitespace or longer than 10,000 chars (Req 1.4).
//  6. Gateway configured — 503 when h.client is nil (Req 9.1).
//
// Only then does it run the loop and map the result. A run that does not reach
// save_draft persisted nothing, so the draft is unchanged either way (Req 9.3).
func (h *Handler) handleAgentFill(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Guards 1-4 (identity 401 → id/existence 404 → ownership 403 → status 422)
	// are shared with handleAgentChat; loadOwnedDraft runs them and writes the
	// error response itself when one fails. The gateway-nil 503 check stays
	// here, AFTER account validation, so an invalid account is rejected before
	// we ever look at whether the gateway is configured.
	rec, ok := h.loadOwnedDraft(w, r)
	if !ok {
		return
	}

	// 5. Decode and validate the account. Empty/whitespace or over the length
	// bound is a validation error with zero gateway calls (Req 1.4).
	var req agentFillRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "bad_request", "request body could not be decoded")
		return
	}
	account := strings.TrimSpace(req.Account)
	if account == "" {
		httpx.WriteValidationError(w, "account is required", nil)
		return
	}
	if len(account) > maxAccountLen {
		httpx.WriteValidationError(w, "account must be at most 10000 characters", nil)
		return
	}

	// 6. Gateway unconfigured: the agent is unavailable, but the manual fill
	// path still works. Draft untouched (Req 9.1).
	if h.client == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "agent_unavailable", "the AI assistant is unavailable right now")
		return
	}

	// Every guard has passed: run the loop. persist writes through the same
	// reports.ValidateContent + Store.Update boundary a manual save uses, and
	// is called at most once, on save_draft.
	persist := newPersistFunc(h.store, rec.ID, rec.SchemaSnapshot, rec.Content.FilledBy, rec.CustomerName)
	runner := NewRunner(h.client)
	res, runErr := runner.Run(ctx, RunInput{
		ReportID: rec.ID,
		Schema:   rec.SchemaSnapshot,
		Content:  rec.Content,
		JobID:    rec.JobID,
		// agent-fill is one-shot: the account is a single technician-role
		// message and no questions are allowed (QuestionsRemaining: 0 makes the
		// prompt tell the model not to ask). This keeps the one-shot path
		// behaving exactly as before atop the generalized runner.
		Messages:           []ConversationMessage{{Role: "technician", Content: account}},
		QuestionsRemaining: 0,
		Jobs:               h.jobs,
		Parts:              h.parts,
	}, persist)

	// Record the run server-side for replay/debugging (Req 8.1, 8.2). The run
	// log never holds the gateway key (Req 7.3), and neither does this line.
	log.Printf("agent: run report=%s terminatedBy=%s tokens=%d saved=%t",
		rec.ID, res.TerminatedBy, res.TotalTokens, res.Saved)

	if runErr != nil {
		// A persist-time validation error (unknown field id, bad type) maps to
		// 422 naming the offending element; the draft is unchanged. Any other
		// error is a gateway/timeout failure → 503 so the technician falls back
		// to the manual path (Req 9.1, 9.2).
		var verr *reports.ValidationError
		if errors.As(runErr, &verr) {
			httpx.WriteValidationError(w, verr.Message, elementIDPtr(verr.Element))
			return
		}
		httpx.WriteError(w, http.StatusServiceUnavailable, "agent_unavailable", "the AI assistant is unavailable right now")
		return
	}

	// The run succeeded (no error). Whether or not it saved, reload the record
	// so the response carries the current persisted state: on Saved the updated
	// filled_by/content, on an unsaved run (parse_failure / iteration_cap) the
	// unchanged draft, so the technician can continue by hand (Req 9.4).
	report := rec
	if reloaded, err := h.store.Get(ctx, rec.ID); err == nil {
		report = reloaded
	}

	httpx.WriteJSON(w, http.StatusOK, agentFillResponse{
		Report:          report,
		FlaggedFieldIDs: res.FlaggedFieldIDs,
		TokenUsage:      res.TotalTokens,
		TerminatedBy:    res.TerminatedBy,
	})
}

// handleAgentChat runs ONE conversation turn from a client-carried transcript
// (POST /api/reports/{id}/agent-chat). Like handleAgentFill it is
// VALIDATION-FIRST: the shared guard ladder plus transcript validation and the
// turn-cap check all answer before any gateway call, so an invalid request
// never spends a gateway credit and never changes the draft (Req 1.6, 4.4,
// 11.1).
//
// The flow:
//  1. loadOwnedDraft — identity 401 → id 404 → ownership 403 → status 422.
//  2. Decode agentChatRequest (DisallowUnknownFields) — 400 on failure.
//  3. validateTranscript — 422, NO gateway call, NO draft change (Req 1.6, 9.1).
//  4. Turn cap: turnsUsed >= turnCap → 200 terminatedBy "turn_cap", NO gateway
//     call (Req 4.4).
//  5. Gateway configured — 503 when h.client is nil (Req 11.5).
//  6. Run one turn; on a pause/cap turn that produced fills, persist once
//     (Req 5.2, 5.4); map runErr like agent-fill; reload; return the grown
//     transcript and the turn's outcome (Req 1.3, 2.4, 8.1).
func (h *Handler) handleAgentChat(w http.ResponseWriter, r *http.Request) {
	ctx := r.Context()

	// Guards 1-4, shared with handleAgentFill.
	rec, ok := h.loadOwnedDraft(w, r)
	if !ok {
		return
	}

	// a. Decode the transcript. An unknown field or malformed body is a client
	// error, never a gateway call.
	var req agentChatRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "bad_request", "request body could not be decoded")
		return
	}

	// b. Validate the transcript shape. On failure: 422, no gateway call, no
	// draft change (Req 1.6, 9.1).
	if err := validateTranscript(req.Messages); err != nil {
		httpx.WriteValidationError(w, err.Error(), nil)
		return
	}

	// c. Turn cap derived from the transcript. If this chat has already run its
	// budgeted turns, refuse to run another one WITHOUT dialling the gateway
	// (Req 4.4). Reload so the response still carries the current persisted
	// draft; the transcript is returned unchanged.
	turns := turnsUsed(req.Messages)
	q := questionsUsed(req.Messages)
	if turns >= h.turnCap {
		report := rec
		if reloaded, err := h.store.Get(ctx, rec.ID); err == nil {
			report = reloaded
		}
		httpx.WriteJSON(w, http.StatusOK, agentChatResponse{
			Messages:        req.Messages,
			Report:          report,
			FlaggedFieldIDs: []string{},
			AwaitingAnswer:  false,
			TerminatedBy:    "turn_cap",
			TokenUsage:      0,
			TurnsUsed:       turns,
			QuestionsUsed:   q,
		})
		return
	}

	// d. Gateway unconfigured: the agent is unavailable but the manual fill path
	// still works. Draft untouched (Req 11.5).
	if h.client == nil {
		httpx.WriteError(w, http.StatusServiceUnavailable, "agent_unavailable", "the AI assistant is unavailable right now")
		return
	}

	// e. Questions remaining this turn, floored at zero. QuestionsRemaining <= 0
	// makes the prompt tell the model not to ask and the runner reject any
	// ask_technician (Req 4.5).
	questionsRemaining := h.questionCap - q
	if questionsRemaining < 0 {
		questionsRemaining = 0
	}

	// f. Run one turn. persist is the same save_draft closure agent-fill uses;
	// the runner calls it inline on save_draft, and we reuse it below for the
	// pause/cap-with-fills case.
	persist := newPersistFunc(h.store, rec.ID, rec.SchemaSnapshot, rec.Content.FilledBy, rec.CustomerName)
	runner := NewRunner(h.client)
	res, runErr := runner.Run(ctx, RunInput{
		ReportID:           rec.ID,
		Schema:             rec.SchemaSnapshot,
		Content:            rec.Content,
		JobID:              rec.JobID,
		Messages:           req.Messages,
		QuestionsRemaining: questionsRemaining,
		Jobs:               h.jobs,
		Parts:              h.parts,
	}, persist)

	// g. Record the run server-side for replay/debugging (Req 8.1). Never the
	// gateway key.
	log.Printf("agent: chat report=%s terminatedBy=%s tokens=%d saved=%t awaiting=%t",
		rec.ID, res.TerminatedBy, res.TotalTokens, res.Saved, res.AwaitingAnswer)

	// h. Turn-end persist for a pause or per-turn iteration cap that produced
	// fills. save_draft already persisted inline in the runner; this handles the
	// case where the turn paused (ask_technician) or hit the iteration cap with
	// content worth keeping (Req 5.2, 5.4). A validation failure maps to 422
	// naming the offending element, prior content intact; any other write error
	// is a 503.
	if runErr == nil && !res.Saved && res.Filled &&
		(res.TerminatedBy == "ask_technician" || res.TerminatedBy == "iteration_cap") {
		if err := persist(ctx, res.Content); err != nil {
			var verr *reports.ValidationError
			if errors.As(err, &verr) {
				httpx.WriteValidationError(w, verr.Message, elementIDPtr(verr.Element))
				return
			}
			httpx.WriteError(w, http.StatusServiceUnavailable, "agent_unavailable", "the AI assistant is unavailable right now")
			return
		}
	}

	// i. Map a run error exactly like agent-fill: a persist-time validation
	// error → 422 naming the element (draft unchanged); anything else is a
	// gateway/timeout failure → 503 so the technician falls back to the manual
	// path (Req 11.1, 11.2).
	if runErr != nil {
		var verr *reports.ValidationError
		if errors.As(runErr, &verr) {
			httpx.WriteValidationError(w, verr.Message, elementIDPtr(verr.Element))
			return
		}
		httpx.WriteError(w, http.StatusServiceUnavailable, "agent_unavailable", "the AI assistant is unavailable right now")
		return
	}

	// j. Grow the transcript. On a pause we append the agent's question so the
	// client re-sends it next turn and can render it as the last agent message.
	// On a completed/terminated non-pause turn nothing is appended — the
	// transcript ends at the technician's last message, which is fine.
	grown := req.Messages
	if res.AwaitingAnswer {
		grown = append(grown, ConversationMessage{Role: "agent", Content: res.Question})
	}

	// k. Reload so the response carries the persisted content (Saved inline or a
	// turn-end persist above). On reload error fall back to the pre-run record.
	report := rec
	if reloaded, err := h.store.Get(ctx, rec.ID); err == nil {
		report = reloaded
	}

	// l. Return the turn outcome and the transcript-derived usage counts.
	httpx.WriteJSON(w, http.StatusOK, agentChatResponse{
		Messages:        grown,
		Report:          report,
		FlaggedFieldIDs: res.FlaggedFieldIDs,
		AwaitingAnswer:  res.AwaitingAnswer,
		TerminatedBy:    res.TerminatedBy,
		TokenUsage:      res.TotalTokens,
		TurnsUsed:       turnsUsed(grown),
		QuestionsUsed:   questionsUsed(grown),
	})
}

// isUUID reports whether value has the canonical 8-4-4-4-12 hexadecimal UUID
// form. It mirrors reports.isUUID (unexported there): a malformed id would
// otherwise reach SQL as a uuid-typed parameter and come back as a driver error
// reported as a 500 — a client mistake dressed up as a server fault.
func isUUID(value string) bool {
	const uuidLength = 36
	if len(value) != uuidLength {
		return false
	}
	for i := 0; i < uuidLength; i++ {
		c := value[i]
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
		if !isHex {
			return false
		}
	}
	return true
}

// writeStoreError maps an error from the reports store onto a response, the same
// way reports.writeStoreError (unexported there) does for the handler that owns
// the store. A not-found id becomes a 404; anything else is logged server-side
// and answered as a generic 500 so no internal detail leaks.
func writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, reports.ErrNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "report not found")
		return
	}
	log.Printf("agent: %v", err)
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "internal server error")
}

// elementIDPtr converts a reports.ValidationError.Element into the *string the
// 422 body expects: an empty element becomes null, a named element a pointer to
// that id (mirrors reports.elementIDPtr).
func elementIDPtr(element string) *string {
	if element == "" {
		return nil
	}
	return &element
}

// This file will also hold the Agent_Endpoint Handler, NewHandler,
// RegisterRoutes, and handleAgentFill (task 11.1). Task 10.1 adds only the
// save_draft persistence seam: the filled_by transition and the persistFunc
// builder that the endpoint (11.1) hands to Runner.Run. Keeping this piece
// separate keeps it a small, pure, testable unit while leaving the HTTP handler
// to be layered on top in the same package/file.

// filledByAfterAgent computes the Report_Draft filled_by value after the agent
// has contributed content, from the draft's prior filled_by (Req 1.3):
//
//   - prior "" or "agent"          → "agent"  (the agent is the sole author)
//   - prior "manual" or "mixed"    → "mixed"  (a human already contributed)
//
// Any other (unexpected) value is treated as "mixed": once we can't be certain
// the agent is the sole author, "mixed" is the honest, non-destructive answer,
// and reports.ValidateContent would reject the persist anyway if the resulting
// value were not one of the three known constants — so a bogus prior can never
// be laundered into an accepted write.
func filledByAfterAgent(prior string) string {
	switch prior {
	case "", reports.FilledByAgent:
		return reports.FilledByAgent
	case reports.FilledByManual, reports.FilledByMixed:
		return reports.FilledByMixed
	default:
		return reports.FilledByMixed
	}
}

// newPersistFunc builds the save_draft persistence closure the runner invokes
// once, on a save_draft tool call (see runner.go's persistFunc and Run). It
// closes over everything the endpoint (task 11.1) already has in hand from the
// loaded reports.ReportRecord, so 11.1 calls it as:
//
//	persist := newPersistFunc(store, rec.ID, rec.SchemaSnapshot, rec.Content.FilledBy, rec.CustomerName)
//	res, err := runner.Run(ctx, in, persist)
//
// The returned persistFunc, given the runner's in-memory content copy:
//
//  1. Sets content.FilledBy per filledByAfterAgent(priorFilledBy) (Req 1.3). It
//     does NOT set or modify status — the draft stays "draft" (Req 4.1, 4.2).
//     reports.Store.Update never writes status either, so this is doubly safe.
//  2. Runs it through reports.ValidateContent(schema, content, false) — the
//     same requireComplete=false a manual draft save uses. This is the
//     enforcement point for Req 1.2 / 2.7: any value keyed to a field id not in
//     the schema snapshot (or any type/option violation) is rejected and the
//     closure returns the *reports.ValidationError WITHOUT persisting anything.
//     The runner surfaces that error so the endpoint maps it to 422.
//  3. On validation success, persists via store.Update with an empty Title so
//     the stored title is left untouched (per Store.Update semantics) and the
//     existing CustomerName carried through unchanged. Its error is returned as
//     is.
//
// Because the runner mutates only its in-memory copy and calls this exactly
// once on save_draft, a run that fails before save_draft persists nothing — the
// draft keeps its pre-run content, filled_by, and status (Req 9.3).
func newPersistFunc(
	store *reports.Store,
	reportID string,
	schema templates.TemplateSchema,
	priorFilledBy string,
	customerName string,
) persistFunc {
	return func(ctx context.Context, content reports.ReportContent) error {
		content.FilledBy = filledByAfterAgent(priorFilledBy)

		// Validate before writing: the same security boundary the manual draft
		// path uses. On failure, nothing is persisted (Req 1.2, 2.7).
		if err := reports.ValidateContent(schema, content, false); err != nil {
			return err
		}

		// Title:"" leaves the stored title untouched (Store.Update semantics).
		_, err := store.Update(ctx, reportID, reports.UpdateParams{
			Content:      content,
			CustomerName: customerName,
			Title:        "",
		})
		return err
	}
}
