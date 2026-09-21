package dashboard

import (
	"context"
	"database/sql"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"

	_ "github.com/jackc/pgx/v5/stdlib"
)

// These are integration tests: they need a real PostgreSQL database with the
// project's migrations applied, because everything worth checking here — the
// LEFT JOIN that must keep zero-report templates, the jsonb strip that keeps
// photos out of the payload, the per-user scoping — lives in SQL, and a mocked
// database would assert only that the strings were passed through unchanged.
//
// Point DASHBOARD_TEST_DATABASE_URL at a scratch database to run them:
//
//	createdb reportmate_dash_test
//	for f in db/migrations/*.sql; do psql -d reportmate_dash_test -f "$f"; done
//	DASHBOARD_TEST_DATABASE_URL=postgres://localhost/reportmate_dash_test go test ./internal/dashboard/
//
// Without it they skip, so `go test ./...` stays green on a machine with no
// database.

// The two seeded dev users. The second one exists in these tests for exactly
// one reason: to prove that nothing it owns is ever visible to the first.
const (
	meUserID    = "22222222-2222-2222-2222-222222222222"
	otherUserID = "11111111-1111-1111-1111-111111111111"
)

// fixtures is the world one test run builds: a template with every field type
// and reports filed against two of its revisions, plus an untouched template.
type fixtures struct {
	db           *sql.DB
	handler      *Handler
	templateID   string
	emptyID      string
	photoBytes   int
	draftID      string
	currentRevID string
}

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	url := os.Getenv("DASHBOARD_TEST_DATABASE_URL")
	if url == "" {
		t.Skip("DASHBOARD_TEST_DATABASE_URL not set; skipping dashboard integration tests")
	}
	db, err := sql.Open("pgx", url)
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	if err := db.Ping(); err != nil {
		t.Fatalf("ping test database: %v", err)
	}
	t.Cleanup(func() { db.Close() })
	return db
}

// schemaV1 covers all six field types across two sections, so the column
// flattening and every display rule is exercised by one template.
const schemaV1 = `{
  "version": 1,
  "sections": [
    {"id": "sec_a", "label": "Visit", "fields": [
      {"id": "f_notes", "type": "text",      "label": "Notes",      "required": false},
      {"id": "f_meter", "type": "number",    "label": "Meter",      "required": true},
      {"id": "f_ticket","type": "number",    "label": "Ticket",     "required": false},
      {"id": "f_sig",   "type": "signature", "label": "Signature",  "required": false}
    ]},
    {"id": "sec_b", "label": "Diagnostics", "fields": [
      {"id": "f_system", "type": "select",    "label": "System", "required": true,
       "options": ["Split", "Packaged"]},
      {"id": "f_checks", "type": "checklist", "label": "Checks", "required": false,
       "options": ["Gloves", "Hard hat"]},
      {"id": "f_photo",  "type": "photo",     "label": "Photo",  "required": false}
    ]}
  ]
}`

// schemaV2 adds a field to the second section. Reports filed against v1 have no
// value for it, which is what makes the missing-cell marker observable.
const schemaV2 = `{
  "version": 1,
  "sections": [
    {"id": "sec_a", "label": "Visit", "fields": [
      {"id": "f_notes", "type": "text",      "label": "Notes",      "required": false},
      {"id": "f_meter", "type": "number",    "label": "Meter",      "required": true},
      {"id": "f_ticket","type": "number",    "label": "Ticket",     "required": false},
      {"id": "f_sig",   "type": "signature", "label": "Signature",  "required": false}
    ]},
    {"id": "sec_b", "label": "Diagnostics", "fields": [
      {"id": "f_system", "type": "select",    "label": "System", "required": true,
       "options": ["Split", "Packaged"]},
      {"id": "f_checks", "type": "checklist", "label": "Checks", "required": false,
       "options": ["Gloves", "Hard hat"]},
      {"id": "f_photo",  "type": "photo",     "label": "Photo",  "required": false},
      {"id": "f_added",  "type": "text",      "label": "Added later", "required": false}
    ]}
  ]
}`

func setup(t *testing.T) *fixtures {
	t.Helper()
	db := openTestDB(t)

	// Idempotent teardown-then-build, so a failed run leaves nothing behind
	// that poisons the next one.
	exec(t, db, `DELETE FROM service_reports WHERE template_id IN
	                (SELECT id FROM report_templates WHERE name LIKE 'ZZ Test%')`)
	exec(t, db, `DELETE FROM report_templates WHERE name LIKE 'ZZ Test%'`)

	var templateID, emptyID string
	if err := db.QueryRow(
		`INSERT INTO report_templates (name, schema, is_seed) VALUES ('ZZ Test Table', $1, false) RETURNING id`,
		schemaV1).Scan(&templateID); err != nil {
		t.Fatalf("insert template: %v", err)
	}
	if err := db.QueryRow(
		`INSERT INTO report_templates (name, schema, is_seed) VALUES ('ZZ Test Empty', $1, false) RETURNING id`,
		schemaV1).Scan(&emptyID); err != nil {
		t.Fatalf("insert empty template: %v", err)
	}

	// A ~1 MB base64 data URL, the shape a real inline photo has.
	photo := "data:image/png;base64," + strings.Repeat("A", 1<<20)
	signature := "data:image/png;base64,iVBORw0KGgo="

	// Deliberately awkward text: a comma and a double quote, so the CSV writer
	// has something real to escape.
	// Built as a raw JSON literal rather than through json.Marshal: Go renders
	// 12.50 as "12.5" before it ever reaches the database, which would quietly
	// remove the very thing the number rule is asserted on below. jsonb keeps a
	// number's scale and its full integer precision, and so must the cell.
	values1 := fmt.Sprintf(`{
	        "f_notes":  %s,
	        "f_meter":  12.50,
	        "f_ticket": 900719925474099123,
	        "f_sig":    %s,
	        "f_system": "Split",
	        "f_checks": ["Gloves", "Hard hat"],
	        "f_photo":  %s
	}`, mustJSON(t, `Replaced the "blower", twice`), mustJSON(t, signature), mustJSON(t, photo))
	// Present-but-empty attachments, to separate "" from the missing marker.
	values2 := mustJSON(t, map[string]any{
		"f_notes":  "Routine check",
		"f_meter":  7,
		"f_sig":    "",
		"f_system": "Packaged",
		"f_checks": []string{},
		"f_photo":  nil,
	})
	// A report that omits the attachment fields entirely.
	values3 := mustJSON(t, map[string]any{"f_notes": "Quick visit", "f_meter": 1})

	base := time.Date(2026, 3, 1, 9, 0, 0, 0, time.UTC)
	draftID := insertReport(t, db, templateID, meUserID, 1, "draft", "Acme, Inc.", "Boiler swap", values1, base.Add(72*time.Hour))
	insertReport(t, db, templateID, meUserID, 1, "submitted", "Bravo Ltd", "Routine", values2, base.Add(48*time.Hour))
	insertReport(t, db, templateID, meUserID, 1, "exported", "Charlie Co", "Callout", values3, base.Add(24*time.Hour))

	// Another user's report against the same template. It must never surface.
	insertReport(t, db, templateID, otherUserID, 1, "draft", "NOT MINE", "Secret", values3, base.Add(96*time.Hour))

	// The template is edited: a new field, a new revision. Everything above is
	// now stale; what comes next is not.
	exec(t, db, `UPDATE report_templates SET schema = $2, revision = 2, updated_at = now() WHERE id = $1`,
		templateID, schemaV2)

	valuesCurrent := mustJSON(t, map[string]any{
		"f_notes": "After the edit", "f_meter": 3, "f_system": "Split", "f_added": "new value",
	})
	currentRevID := insertReport(t, db, templateID, meUserID, 2, "draft", "Delta GmbH", "Post-edit", valuesCurrent, base.Add(120*time.Hour))

	return &fixtures{
		db:           db,
		handler:      NewHandler(db),
		templateID:   templateID,
		emptyID:      emptyID,
		photoBytes:   len(photo),
		draftID:      draftID,
		currentRevID: currentRevID,
	}
}

func exec(t *testing.T, db *sql.DB, query string, args ...any) {
	t.Helper()
	if _, err := db.Exec(query, args...); err != nil {
		t.Fatalf("exec %.40q: %v", query, err)
	}
}

func mustJSON(t *testing.T, v any) string {
	t.Helper()
	raw, err := json.Marshal(v)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	return string(raw)
}

func insertReport(t *testing.T, db *sql.DB, templateID, techID string, revision int, status, customer, title, values string, createdAt time.Time) string {
	t.Helper()
	content := fmt.Sprintf(`{"values": %s, "parts": [], "filledBy": "manual"}`, values)
	var id string
	err := db.QueryRow(`
		INSERT INTO service_reports
		    (template_id, template_revision, schema_snapshot, technician_id, title,
		     customer_name, content, status, created_at, updated_at)
		VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7::jsonb, $8, $9, $9)
		RETURNING id`,
		templateID, revision, schemaV1, techID, title, customer, content, status, createdAt).Scan(&id)
	if err != nil {
		t.Fatalf("insert report: %v", err)
	}
	return id
}

// call issues a request through the real route table with userID attached the
// way the auth middleware attaches it.
func call(t *testing.T, f *fixtures, target, userID string) *httptest.ResponseRecorder {
	t.Helper()
	mux := http.NewServeMux()
	f.handler.RegisterRoutes(mux)

	req := httptest.NewRequest(http.MethodGet, target, nil)
	if userID != "" {
		req = req.WithContext(middleware.WithUserID(context.Background(), userID))
	}
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, req)
	return rec
}

func decodeJSON[T any](t *testing.T, rec *httptest.ResponseRecorder) T {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var out T
	if err := json.Unmarshal(rec.Body.Bytes(), &out); err != nil {
		t.Fatalf("decode body: %v (body = %.200s)", err, rec.Body.String())
	}
	return out
}

// --- Acceptance check 2: rollups ---------------------------------------------

func TestRollupsCountOnlyMyReportsAndKeepEmptyTemplates(t *testing.T) {
	f := setup(t)

	rollups := decodeJSON[[]TemplateRollup](t, call(t, f, "/api/dashboard/templates", meUserID))

	byID := make(map[string]TemplateRollup, len(rollups))
	for _, r := range rollups {
		byID[r.TemplateID] = r
	}

	empty, ok := byID[f.emptyID]
	if !ok {
		t.Fatal("a template with zero reports vanished from the rollup list")
	}
	if empty.ReportCount != 0 || empty.LastReportAt != nil {
		t.Errorf("empty template: reportCount = %d, lastReportAt = %v; want 0 and null",
			empty.ReportCount, empty.LastReportAt)
	}

	filled := byID[f.templateID]
	// Four of mine (3 at revision 1 + 1 at revision 2); the fifth belongs to
	// the other user and must not be counted.
	if filled.ReportCount != 4 {
		t.Errorf("reportCount = %d, want 4 (the other user's report must not count)", filled.ReportCount)
	}
	if filled.DraftCount != 2 || filled.SubmittedCount != 1 || filled.ExportedCount != 1 {
		t.Errorf("counts = draft %d / submitted %d / exported %d; want 2 / 1 / 1",
			filled.DraftCount, filled.SubmittedCount, filled.ExportedCount)
	}
	if filled.Revision != 2 {
		t.Errorf("revision = %d, want 2", filled.Revision)
	}
	if filled.LastReportAt == nil {
		t.Error("lastReportAt is null on a template with reports")
	}

	// Ordering: activity first, then the untouched templates.
	if len(rollups) == 0 || rollups[0].TemplateID != f.templateID {
		t.Errorf("most recent activity should sort first, got %+v", rollups[0])
	}
}

// --- Acceptance check 8: the other user's data ---------------------------------

func TestOtherUsersReportsAreInvisible(t *testing.T) {
	f := setup(t)

	rollups := decodeJSON[[]TemplateRollup](t, call(t, f, "/api/dashboard/templates", otherUserID))
	for _, r := range rollups {
		if r.TemplateID == f.templateID && r.ReportCount != 1 {
			t.Errorf("other user sees reportCount %d, want only their own 1", r.ReportCount)
		}
	}

	view := decodeJSON[TableView](t, call(t, f, "/api/dashboard/templates/"+f.templateID, meUserID))
	for _, row := range view.Rows {
		if row.CustomerName == "NOT MINE" {
			t.Fatal("the other user's report appeared in my report table")
		}
	}
	if view.Total != 4 {
		t.Errorf("total = %d, want 4 (mine only)", view.Total)
	}

	rec := call(t, f, "/api/dashboard/templates/"+f.templateID+"/export.csv", meUserID)
	if strings.Contains(rec.Body.String(), "NOT MINE") {
		t.Fatal("the other user's report appeared in my CSV export")
	}
}

// --- Acceptance checks 3, 4, 6: columns, the strip, stale revisions -----------

func TestReportTableColumnsCellsAndPayload(t *testing.T) {
	f := setup(t)

	rec := call(t, f, "/api/dashboard/templates/"+f.templateID, meUserID)
	view := decodeJSON[TableView](t, rec)

	wantColumns := []string{"f_notes", "f_meter", "f_ticket", "f_sig", "f_system", "f_checks", "f_photo", "f_added"}
	if len(view.Columns) != len(wantColumns) {
		t.Fatalf("got %d columns, want %d: %+v", len(view.Columns), len(wantColumns), view.Columns)
	}
	for i, want := range wantColumns {
		if view.Columns[i].FieldID != want {
			t.Errorf("column %d = %q, want %q (section order)", i, view.Columns[i].FieldID, want)
		}
	}
	if view.Columns[0].SectionLabel != "Visit" || view.Columns[7].SectionLabel != "Diagnostics" {
		t.Errorf("section labels not carried: %+v", view.Columns)
	}

	// Acceptance check 4: a 1 MB photo went in; the response must not carry it.
	if body := rec.Body.Len(); body > f.photoBytes/10 {
		t.Errorf("response is %d bytes with a %d byte photo stored — the jsonb strip is not working",
			body, f.photoBytes)
	}
	if strings.Contains(rec.Body.String(), strings.Repeat("A", 100)) {
		t.Error("base64 photo data leaked into the response")
	}

	rows := make(map[string]TableRow, len(view.Rows))
	for _, row := range view.Rows {
		rows[row.CustomerName] = row
	}

	acme := rows["Acme, Inc."]
	checks := map[string]string{
		"f_notes":  `Replaced the "blower", twice`,
		"f_meter":  "12.50",              // scale preserved: not 12.5
		"f_ticket": "900719925474099123", // full precision: not 9.007199254740991e+17
		"f_sig":    signedCell,
		"f_system": "Split",
		"f_checks": "Gloves, Hard hat",
		"f_photo":  photoCell,
		"f_added":  missingCell,
	}
	for fieldID, want := range checks {
		if got := acme.Cells[fieldID]; got != want {
			t.Errorf("cells[%s] = %q, want %q", fieldID, got, want)
		}
	}
	if !acme.StaleRevision {
		t.Error("a report filed against revision 1 of a revision-2 template is not flagged stale")
	}

	// Present but empty is "" — distinct from a field the report never had.
	bravo := rows["Bravo Ltd"]
	if bravo.Cells["f_photo"] != "" || bravo.Cells["f_sig"] != "" || bravo.Cells["f_checks"] != "" {
		t.Errorf("empty values should render as \"\", got photo %q sig %q checks %q",
			bravo.Cells["f_photo"], bravo.Cells["f_sig"], bravo.Cells["f_checks"])
	}

	// A report that never carried the attachment keys at all.
	charlie := rows["Charlie Co"]
	if charlie.Cells["f_photo"] != missingCell || charlie.Cells["f_sig"] != missingCell {
		t.Errorf("absent attachment fields should render as %q, got photo %q sig %q",
			missingCell, charlie.Cells["f_photo"], charlie.Cells["f_sig"])
	}

	delta := rows["Delta GmbH"]
	if delta.StaleRevision {
		t.Error("a report filed against the current revision is flagged stale")
	}
	if delta.Cells["f_added"] != "new value" {
		t.Errorf("cells[f_added] = %q, want %q", delta.Cells["f_added"], "new value")
	}

	// Newest first.
	if view.Rows[0].CustomerName != "Delta GmbH" {
		t.Errorf("rows are not newest-first: %q leads", view.Rows[0].CustomerName)
	}
}

// --- Acceptance check 5: filters and paging ------------------------------------

func TestFiltersAndPaging(t *testing.T) {
	f := setup(t)

	cases := []struct {
		name      string
		query     string
		wantTotal int
		wantRows  int
	}{
		{"unfiltered", "", 4, 4},
		{"status", "?status=draft", 2, 2},
		{"from", "?from=2026-03-05", 1, 1},
		{"to includes the whole day", "?to=2026-03-04", 3, 3},
		{"window", "?from=2026-03-03&to=2026-03-04", 2, 2},
		{"search customer", "?q=acme", 1, 1},
		{"search title", "?q=callout", 1, 1},
		{"search cell values", "?q=blower", 1, 1},
		{"search misses", "?q=nothing-matches-this", 0, 0},
		{"page 1", "?limit=2", 4, 2},
		{"page 2", "?limit=2&offset=2", 4, 2},
		{"page past the end", "?limit=2&offset=99", 4, 0},
		{"limit is capped", "?limit=5000", 4, 4},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			view := decodeJSON[TableView](t, call(t, f, "/api/dashboard/templates/"+f.templateID+tc.query, meUserID))
			if view.Total != tc.wantTotal {
				t.Errorf("total = %d, want %d", view.Total, tc.wantTotal)
			}
			if len(view.Rows) != tc.wantRows {
				t.Errorf("rows = %d, want %d", len(view.Rows), tc.wantRows)
			}
		})
	}

	if view := decodeJSON[TableView](t, call(t, f, "/api/dashboard/templates/"+f.templateID+"?limit=5000", meUserID)); view.Limit != maxLimit {
		t.Errorf("limit = %d, want it clamped to %d", view.Limit, maxLimit)
	}

	// A photo's base64 must not be searchable — it was stripped before the
	// search ran, which is also what stops a stray "AAAA" matching every row.
	view := decodeJSON[TableView](t, call(t, f, "/api/dashboard/templates/"+f.templateID+"?q="+strings.Repeat("A", 60), meUserID))
	if view.Total != 0 {
		t.Errorf("search matched stripped photo data: total = %d", view.Total)
	}
}

// --- Acceptance check 7: CSV ---------------------------------------------------

func TestExportCSV(t *testing.T) {
	f := setup(t)

	rec := call(t, f, "/api/dashboard/templates/"+f.templateID+"/export.csv", meUserID)
	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	if ct := rec.Header().Get("Content-Type"); !strings.HasPrefix(ct, "text/csv") {
		t.Errorf("Content-Type = %q, want text/csv", ct)
	}
	if cd := rec.Header().Get("Content-Disposition"); !strings.Contains(cd, "zz-test-table-reports-") {
		t.Errorf("Content-Disposition = %q, want a filename from the template name", cd)
	}

	records, err := csv.NewReader(strings.NewReader(rec.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("parse csv: %v", err)
	}
	if len(records) != 5 { // header + 4 reports
		t.Fatalf("got %d csv records, want 5", len(records))
	}

	wantHeader := []string{"Date", "Status", "Customer", "Revision",
		"Notes", "Meter", "Ticket", "Signature", "System", "Checks", "Photo", "Added later"}
	for i, want := range wantHeader {
		if records[0][i] != want {
			t.Errorf("header[%d] = %q, want %q", i, records[0][i], want)
		}
	}

	// The comma-and-quote cell must survive the round trip intact.
	var found bool
	for _, record := range records[1:] {
		if record[2] == "Acme, Inc." {
			found = true
			if record[4] != `Replaced the "blower", twice` {
				t.Errorf("escaped cell = %q, want the original text", record[4])
			}
			if record[3] != "1" {
				t.Errorf("revision column = %q, want 1", record[3])
			}
		}
	}
	if !found {
		t.Error("the row with commas and quotes in it did not survive the CSV round trip")
	}

	// An export ignores paging: the whole filtered set comes back.
	paged := call(t, f, "/api/dashboard/templates/"+f.templateID+"/export.csv?limit=1&status=draft", meUserID)
	pagedRecords, err := csv.NewReader(strings.NewReader(paged.Body.String())).ReadAll()
	if err != nil {
		t.Fatalf("parse filtered csv: %v", err)
	}
	if len(pagedRecords) != 3 { // header + both drafts
		t.Errorf("filtered export has %d records, want 3 (limit must be ignored, status must not be)", len(pagedRecords))
	}
}

// --- Request-level guards ------------------------------------------------------

func TestRequestGuards(t *testing.T) {
	f := setup(t)

	cases := []struct {
		name   string
		target string
		userID string
		want   int
	}{
		{"no identity", "/api/dashboard/templates", "", http.StatusUnauthorized},
		{"no identity on table", "/api/dashboard/templates/" + f.templateID, "", http.StatusUnauthorized},
		{"malformed id", "/api/dashboard/templates/not-a-uuid", meUserID, http.StatusNotFound},
		{"unknown template", "/api/dashboard/templates/00000000-0000-0000-0000-000000000000", meUserID, http.StatusNotFound},
		{"bad status", "/api/dashboard/templates/" + f.templateID + "?status=nope", meUserID, http.StatusBadRequest},
		{"bad date", "/api/dashboard/templates/" + f.templateID + "?from=01-03-2026", meUserID, http.StatusBadRequest},
		{"bad limit", "/api/dashboard/templates/" + f.templateID + "?limit=0", meUserID, http.StatusBadRequest},
		{"bad offset", "/api/dashboard/templates/" + f.templateID + "?offset=-1", meUserID, http.StatusBadRequest},
	}

	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if rec := call(t, f, tc.target, tc.userID); rec.Code != tc.want {
				t.Errorf("status = %d, want %d (body %s)", rec.Code, tc.want, rec.Body.String())
			}
		})
	}
}
