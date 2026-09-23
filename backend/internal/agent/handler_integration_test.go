package agent

// DB-touching integration tests for the agent endpoint (Properties 5, 8 and the
// endpoint happy-path + guards from task 11.4). They need a real PostgreSQL with
// the project's migrations applied and are gated behind AGENT_TEST_DATABASE_URL,
// so `go test ./...` stays green on a machine with no database.
//
//	createdb reportmate_agent_test
//	for f in db/migrations/*.sql; do psql -d reportmate_agent_test -f "$f"; done
//	AGENT_TEST_DATABASE_URL=postgres://localhost/reportmate_agent_test go test ./internal/agent/
//
// The gateway is ALWAYS a scripted mock here — no live call, no shared credit
// spent (the cost-discipline rule). The mock is injected as the Handler's
// chatClient via newTestHandler.

import (
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"

	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
	"github.com/LucasChen1108/Report-Mate/backend/internal/reports"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// The seeded dev technician (0009_seed_dev_users.sql). Reports are owned by this
// user so the technician-ownership guard passes.
const testTechnicianID = "11111111-1111-1111-1111-111111111111"

// a schema with two fillable fields, one required — enough to exercise fill,
// flag, and the required-field paths.
const agentTestSchema = `{
  "version": 1,
  "sections": [
    {"id": "sec", "label": "Visit", "fields": [
      {"id": "fld_notes", "type": "text",   "label": "Notes",  "required": false},
      {"id": "fld_meter", "type": "number", "label": "Meter",  "required": true}
    ]}
  ]
}`

func openAgentTestDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("AGENT_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("AGENT_TEST_DATABASE_URL not set; skipping agent integration tests")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("ping test db: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// seedDraft inserts a template + a draft report owned by the test technician and
// returns the report id. status is 'draft' unless overridden.
func seedDraft(t *testing.T, db *sql.DB, status string) string {
	t.Helper()

	var templateID string
	if err := db.QueryRow(
		`INSERT INTO report_templates (name, schema, is_seed) VALUES ('ZZ Agent Test', $1, false) RETURNING id`,
		agentTestSchema,
	).Scan(&templateID); err != nil {
		t.Fatalf("insert template: %v", err)
	}

	content := `{"values":{},"parts":[],"filledBy":"manual"}`
	var reportID string
	if err := db.QueryRow(
		`INSERT INTO service_reports
		   (template_id, template_revision, schema_snapshot, technician_id, title, customer_name, content, filled_by, status)
		 VALUES ($1, 1, $2, $3, 'ZZ Agent Draft', 'Acme Co', $4, 'manual', $5)
		 RETURNING id`,
		templateID, agentTestSchema, testTechnicianID, content, status,
	).Scan(&reportID); err != nil {
		t.Fatalf("insert draft: %v", err)
	}

	t.Cleanup(func() {
		db.Exec(`DELETE FROM service_reports WHERE id = $1`, reportID)
		db.Exec(`DELETE FROM report_templates WHERE id = $1`, templateID)
	})
	return reportID
}

// newTestHandler builds an agent Handler over the test db with a scripted mock
// gateway (never a live client) and the empty context providers.
func newTestHandler(db *sql.DB, client chatClient) *Handler {
	return NewHandler(db, client, EmptyJobHistory{}, EmptyPartsCatalog{}, defaultTurnCap, defaultQuestionCap)
}

// authedFillRequest builds a POST agent-fill request for reportID with the
// technician identity attached to its context, as the identity middleware would.
func authedFillRequest(t *testing.T, reportID, account string) *http.Request {
	t.Helper()
	body, _ := json.Marshal(agentFillRequest{Account: account})
	req := httptest.NewRequest(http.MethodPost, "/api/reports/"+reportID+"/agent-fill", strings.NewReader(string(body)))
	req.SetPathValue("id", reportID)
	ctx := middleware.WithUserID(req.Context(), testTechnicianID)
	ctx = middleware.WithRole(ctx, technicianRole)
	return req.WithContext(ctx)
}

// -----------------------------------------------------------------------------
// Endpoint happy path (task 11.4): a scripted run get_template_schema ->
// fill_field -> flag_missing_field -> save_draft persists the draft, updates
// filled_by to include the agent, keeps status 'draft', and returns the flagged
// id.
// -----------------------------------------------------------------------------
func TestEndpoint_HappyPathPersistsDraft(t *testing.T) {
	db := openAgentTestDB(t)
	reportID := seedDraft(t, db, reports.StatusDraft)

	client := &scriptedClient{replies: []string{
		`{"tool":"get_template_schema"}`,
		`{"tool":"fill_field","field_id":"fld_notes","value":"Replaced the capacitor."}`,
		`{"tool":"flag_missing_field","field_id":"fld_meter"}`,
		`{"tool":"save_draft"}`,
	}, tokensPerCall: 5}

	h := newTestHandler(db, client)
	rec := httptest.NewRecorder()
	h.handleAgentFill(rec, authedFillRequest(t, reportID, "I replaced the capacitor; forgot to read the meter."))

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200; body=%s", rec.Code, rec.Body.String())
	}
	var resp agentFillResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if resp.Report.Status != reports.StatusDraft {
		t.Errorf("status after run = %q, want draft (Property 5)", resp.Report.Status)
	}
	if resp.Report.FilledBy != reports.FilledByMixed {
		// prior manual + agent contribution -> mixed
		t.Errorf("filledBy = %q, want mixed", resp.Report.FilledBy)
	}
	if got, ok := resp.Report.Content.Values["fld_notes"]; !ok || !strings.Contains(string(got), "capacitor") {
		t.Errorf("fld_notes not persisted, got %q", string(got))
	}
	foundFlag := false
	for _, id := range resp.FlaggedFieldIDs {
		if id == "fld_meter" {
			foundFlag = true
		}
	}
	if !foundFlag {
		t.Errorf("flaggedFieldIds = %v, want it to include fld_meter", resp.FlaggedFieldIDs)
	}
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 5: a completed run never changes report status.
// Runs a saving run against a draft and asserts status is still 'draft'
// afterwards (never submitted/exported).
// Validates: Requirements 4.1, 4.2.
// -----------------------------------------------------------------------------
func TestProperty5_CompletedRunNeverChangesStatus(t *testing.T) {
	db := openAgentTestDB(t)

	for i := 0; i < 5; i++ { // a handful of real DB round-trips
		reportID := seedDraft(t, db, reports.StatusDraft)
		client := &scriptedClient{replies: []string{
			`{"tool":"fill_field","field_id":"fld_notes","value":"work done"}`,
			`{"tool":"save_draft"}`,
		}}
		h := newTestHandler(db, client)
		rec := httptest.NewRecorder()
		h.handleAgentFill(rec, authedFillRequest(t, reportID, "did the work"))
		if rec.Code != http.StatusOK {
			t.Fatalf("iter %d: status=%d body=%s", i, rec.Code, rec.Body.String())
		}

		var status string
		if err := db.QueryRow(`SELECT status FROM service_reports WHERE id=$1`, reportID).Scan(&status); err != nil {
			t.Fatalf("iter %d: read status: %v", i, err)
		}
		if status != reports.StatusDraft {
			t.Fatalf("iter %d: status after run = %q, want draft", i, status)
		}
	}
}

// -----------------------------------------------------------------------------
// Feature: ai-agent, Property 8: invalid accounts are rejected without
// contacting the gateway.
// Empty/whitespace/oversized accounts return 422, the spy gateway is never
// called, and the draft is unchanged.
// Validates: Requirements 1.4.
// -----------------------------------------------------------------------------
func TestProperty8_InvalidAccountRejectedWithoutGatewayCall(t *testing.T) {
	db := openAgentTestDB(t)

	bad := []string{
		"",                       // empty
		"   \t\n  ",              // whitespace
		strings.Repeat("x", 10001), // over the 10000 limit
	}
	for i, account := range bad {
		reportID := seedDraft(t, db, reports.StatusDraft)
		spy := &scriptedClient{} // any call would increment callCount
		h := newTestHandler(db, spy)
		rec := httptest.NewRecorder()
		h.handleAgentFill(rec, authedFillRequest(t, reportID, account))

		if rec.Code != http.StatusUnprocessableEntity {
			t.Fatalf("case %d: status=%d, want 422; body=%s", i, rec.Code, rec.Body.String())
		}
		if spy.callCount() != 0 {
			t.Fatalf("case %d: gateway called %d times for an invalid account", i, spy.callCount())
		}
		// Draft content unchanged (still empty values).
		var content string
		if err := db.QueryRow(`SELECT content::text FROM service_reports WHERE id=$1`, reportID).Scan(&content); err != nil {
			t.Fatalf("case %d: read content: %v", i, err)
		}
		if !strings.Contains(content, `"values": {}`) && !strings.Contains(content, `"values":{}`) {
			t.Fatalf("case %d: draft content changed on an invalid account: %s", i, content)
		}
	}
}

// -----------------------------------------------------------------------------
// Guard: an exported report is refused with the clear status-specific message
// and a 422 that carries elementId (so the frontend shows the real message, not
// "template failed validation"). No gateway call.
// -----------------------------------------------------------------------------
func TestEndpoint_ExportedReportRefusedClearly(t *testing.T) {
	db := openAgentTestDB(t)
	reportID := seedDraft(t, db, reports.StatusExported)

	spy := &scriptedClient{}
	h := newTestHandler(db, spy)
	rec := httptest.NewRecorder()
	h.handleAgentFill(rec, authedFillRequest(t, reportID, "please revise"))

	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status=%d, want 422; body=%s", rec.Code, rec.Body.String())
	}
	if spy.callCount() != 0 {
		t.Fatalf("gateway called %d times for an exported report", spy.callCount())
	}
	var body struct {
		Code      string  `json:"code"`
		Message   string  `json:"message"`
		ElementID *string `json:"elementId"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode body: %v", err)
	}
	// The body must be a well-formed validation error (elementId key present),
	// and the message must be the clear exported-report wording, not a generic
	// "template failed validation".
	if body.Code != "validation_error" {
		t.Errorf("code = %q, want validation_error", body.Code)
	}
	if !strings.Contains(strings.ToLower(body.Message), "exported") {
		t.Errorf("message = %q, want it to mention the report was exported", body.Message)
	}
}


