package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/db/migrations"
	"github.com/LucasChen1108/Report-Mate/backend/internal/accounts"
	"github.com/LucasChen1108/Report-Mate/backend/internal/auth"
	database "github.com/LucasChen1108/Report-Mate/backend/internal/db"
	"github.com/LucasChen1108/Report-Mate/backend/internal/security"
	_ "github.com/jackc/pgx/v5/stdlib"
)

const journeyPassword = "StageBPassword9"

// TestStageBPostgresHTTPJourneys exercises the real migration stream, stores,
// middleware, and HTTP handlers together. Each run gets its own PostgreSQL
// schema, so it neither depends on nor mutates another developer's fixtures.
func TestStageBPostgresHTTPJourneys(t *testing.T) {
	pool := openIsolatedStageBDatabase(t)
	t.Setenv("EXPORT_DIR", t.TempDir())

	var knownCredentials int
	if err := pool.QueryRow(`
		SELECT count(*) FROM user_login_emails
		WHERE normalized_email IN ('dispatch@reportmate.local', 'tech@reportmate.local')`).Scan(&knownCredentials); err != nil {
		t.Fatalf("check production credential stream: %v", err)
	}
	if knownCredentials != 0 {
		t.Fatalf("production migrations installed %d known development identities", knownCredentials)
	}

	store := accounts.NewPostgresStore(pool)
	now := time.Now().UTC().Truncate(time.Second)
	suffix := strings.ReplaceAll(mustJourneyID(t), "-", "")[:10]
	companyOne := accounts.Company{ID: mustJourneyID(t), Name: "Journey One " + suffix}
	companyTwo := accounts.Company{ID: mustJourneyID(t), Name: "Journey Two " + suffix}
	for _, company := range []accounts.Company{companyOne, companyTwo} {
		if err := store.CreateCompany(context.Background(), company); err != nil {
			t.Fatalf("create company %q: %v", company.Name, err)
		}
	}

	app := newApplicationHandler(pool, false)
	adminOneCode := createAdminCode(t, pool, store, companyOne.ID, "ADMIN-ONE-"+suffix, now.Add(time.Hour), false)
	adminOnePersonal := "admin.one." + suffix + "@example.test"
	adminOneCompany := "admin.one." + suffix + "@company.test"
	adminOneResponse := doJSON(t, app, http.MethodPost, "/auth/register", registrationBody(
		accounts.RoleAdmin, "Admin One", companyOne.Name, adminOnePersonal, adminOneCompany, adminOneCode,
	), nil)
	assertStatus(t, adminOneResponse, http.StatusCreated)
	adminOneCookie := sessionCookie(t, adminOneResponse)

	// Registration session, logout/replay, both-email login, and login rotation.
	assertStatus(t, doJSON(t, app, http.MethodGet, "/auth/me", nil, adminOneCookie), http.StatusOK)
	assertStatus(t, doJSON(t, app, http.MethodPost, "/auth/logout", nil, adminOneCookie), http.StatusNoContent)
	assertCode(t, doJSON(t, app, http.MethodGet, "/auth/me", nil, adminOneCookie), http.StatusUnauthorized, "session_expired")
	personalLogin := login(t, app, adminOnePersonal, nil)
	companyLogin := login(t, app, adminOneCompany, personalLogin)
	assertCode(t, doJSON(t, app, http.MethodGet, "/auth/me", nil, personalLogin), http.StatusUnauthorized, "session_expired")
	adminOneCookie = companyLogin

	// Production composition must issue the same opaque cookie with Secure set.
	productionLogin := doJSON(t, newApplicationHandler(pool, true), http.MethodPost, "/auth/login", map[string]any{
		"email": adminOneCompany, "password": journeyPassword,
	}, nil)
	assertStatus(t, productionLogin, http.StatusOK)
	if cookie := sessionCookie(t, productionLogin); !cookie.HttpOnly || !cookie.Secure || cookie.SameSite != http.SameSiteLaxMode {
		t.Fatalf("production cookie flags = HttpOnly:%t Secure:%t SameSite:%v", cookie.HttpOnly, cookie.Secure, cookie.SameSite)
	}

	adminTwoCode := createAdminCode(t, pool, store, companyTwo.ID, "ADMIN-TWO-"+suffix, now.Add(time.Hour), false)
	adminTwoResponse := doJSON(t, app, http.MethodPost, "/auth/register", registrationBody(
		accounts.RoleAdmin, "Admin Two", companyTwo.Name,
		"admin.two."+suffix+"@example.test", "admin.two."+suffix+"@company.test", adminTwoCode,
	), nil)
	assertStatus(t, adminTwoResponse, http.StatusCreated)
	adminTwoCookie := sessionCookie(t, adminTwoResponse)

	// Cross-field duplicate identities and every Admin-code terminal state.
	duplicateCode := createAdminCode(t, pool, store, companyOne.ID, "ADMIN-DUP-"+suffix, now.Add(time.Hour), false)
	duplicate := registrationBody(accounts.RoleAdmin, "Duplicate", companyOne.Name,
		adminOneCompany, "duplicate."+suffix+"@company.test", duplicateCode)
	assertCode(t, doJSON(t, app, http.MethodPost, "/auth/register", duplicate, nil), http.StatusConflict, "conflict")

	assertRegistrationCodeFailure(t, app, companyOne.Name, "INVALID-"+suffix, suffix+"invalid", "invalid_code")
	expiredCode := createAdminCode(t, pool, store, companyOne.ID, "ADMIN-EXPIRED-"+suffix, now.Add(-time.Hour), false)
	assertRegistrationCodeFailure(t, app, companyOne.Name, expiredCode, suffix+"expired", "expired_code")
	revokedCode := createAdminCode(t, pool, store, companyOne.ID, "ADMIN-REVOKED-"+suffix, now.Add(time.Hour), true)
	assertRegistrationCodeFailure(t, app, companyOne.Name, revokedCode, suffix+"revoked", "revoked_code")
	mismatchCode := createAdminCode(t, pool, store, companyOne.ID, "ADMIN-MISMATCH-"+suffix, now.Add(time.Hour), false)
	assertRegistrationCodeFailure(t, app, companyTwo.Name, mismatchCode, suffix+"mismatch", "company_mismatch")
	assertRegistrationCodeFailure(t, app, companyOne.Name, adminOneCode, suffix+"used", "used_code")

	// Admin-issued Worker code, Worker registration, session replay, and both-email login.
	joinResponse := doJSON(t, app, http.MethodPost, "/api/admin/join-codes", map[string]any{}, adminOneCookie)
	assertStatus(t, joinResponse, http.StatusCreated)
	joinCode := stringField(t, joinResponse, "code")
	workerPersonal := "worker.one." + suffix + "@example.test"
	workerCompany := "worker.one." + suffix + "@company.test"
	workerResponse := doJSON(t, app, http.MethodPost, "/auth/register", registrationBody(
		accounts.RoleWorker, "Worker One", companyOne.Name, workerPersonal, workerCompany, joinCode,
	), nil)
	assertStatus(t, workerResponse, http.StatusCreated)
	workerID := stringField(t, workerResponse, "id")
	workerCookie := sessionCookie(t, workerResponse)
	assertStatus(t, doJSON(t, app, http.MethodPost, "/auth/logout", nil, workerCookie), http.StatusNoContent)
	assertCode(t, doJSON(t, app, http.MethodGet, "/auth/me", nil, workerCookie), http.StatusUnauthorized, "session_expired")
	workerPersonalCookie := login(t, app, workerPersonal, nil)
	workerCookie = login(t, app, workerCompany, workerPersonalCookie)
	assertCode(t, doJSON(t, app, http.MethodGet, "/auth/me", nil, workerPersonalCookie), http.StatusUnauthorized, "session_expired")

	// Exactly one concurrent request may redeem a single-use Worker code.
	concurrentCodeResponse := doJSON(t, app, http.MethodPost, "/api/admin/join-codes", map[string]any{}, adminOneCookie)
	assertStatus(t, concurrentCodeResponse, http.StatusCreated)
	concurrentCode := stringField(t, concurrentCodeResponse, "code")
	concurrentBodies := [][]byte{
		mustJSON(t, registrationBody(accounts.RoleWorker, "Concurrent One", companyOne.Name,
			"concurrent.one."+suffix+"@example.test", "concurrent.one."+suffix+"@company.test", concurrentCode)),
		mustJSON(t, registrationBody(accounts.RoleWorker, "Concurrent Two", companyOne.Name,
			"concurrent.two."+suffix+"@example.test", "concurrent.two."+suffix+"@company.test", concurrentCode)),
	}
	statuses := make([]int, 0, 2)
	var statusesMu sync.Mutex
	var workers sync.WaitGroup
	for _, body := range concurrentBodies {
		body := body
		workers.Add(1)
		go func() {
			defer workers.Done()
			response := performRequest(app, http.MethodPost, "/auth/register", body, nil)
			statusesMu.Lock()
			statuses = append(statuses, response.Code)
			statusesMu.Unlock()
		}()
	}
	workers.Wait()
	sort.Ints(statuses)
	if fmt.Sprint(statuses) != fmt.Sprint([]int{http.StatusCreated, http.StatusUnprocessableEntity}) {
		t.Fatalf("concurrent redemption statuses = %v", statuses)
	}

	// Profile self-service and complete cross-Admin Worker/code isolation.
	profile := doJSON(t, app, http.MethodPatch, "/api/me", map[string]any{
		"fullName": "Worker Updated", "phone": "+65 6999 0000", "personalEmail": workerPersonal,
	}, workerCookie)
	assertStatus(t, profile, http.StatusOK)
	if got := stringField(t, profile, "fullName"); got != "Worker Updated" {
		t.Fatalf("updated profile name = %q", got)
	}
	adminWorkers := doJSON(t, app, http.MethodGet, "/api/admin/workers", nil, adminOneCookie)
	assertStatus(t, adminWorkers, http.StatusOK)
	if !bodyContainsID(t, adminWorkers, workerID) {
		t.Fatalf("admin Worker list does not contain %s: %s", workerID, adminWorkers.Body.String())
	}
	otherWorkers := doJSON(t, app, http.MethodGet, "/api/admin/workers", nil, adminTwoCookie)
	assertStatus(t, otherWorkers, http.StatusOK)
	if bodyContainsID(t, otherWorkers, workerID) {
		t.Fatal("second Admin could see first Admin's Worker")
	}
	assertCode(t, doJSON(t, app, http.MethodPatch, "/api/admin/workers/"+workerID,
		map[string]any{"isActive": false}, adminTwoCookie), http.StatusNotFound, "not_found")
	activeCode := doJSON(t, app, http.MethodPost, "/api/admin/join-codes", map[string]any{}, adminOneCookie)
	assertStatus(t, activeCode, http.StatusCreated)
	activeCodeID := stringField(t, activeCode, "id")
	assertCode(t, doJSON(t, app, http.MethodDelete, "/api/admin/join-codes/"+activeCodeID, nil, adminTwoCookie), http.StatusNotFound, "not_found")
	assertStatus(t, doJSON(t, app, http.MethodDelete, "/api/admin/join-codes/"+activeCodeID, nil, adminOneCookie), http.StatusOK)
	assertCode(t, doJSON(t, app, http.MethodGet, "/api/admin/workers", nil, workerCookie), http.StatusForbidden, "forbidden")

	// Authenticated template reads, Admin-only writes, and one persisted report journey.
	assertStatus(t, doJSON(t, app, http.MethodGet, "/api/templates", nil, workerCookie), http.StatusOK)
	templateBody := map[string]any{
		"name": "Journey Template " + suffix,
		"schema": map[string]any{
			"version": 1,
			"sections": []any{map[string]any{
				"id": "section_work", "label": "Work",
				"fields": []any{map[string]any{
					"id": "field_notes", "type": "text", "label": "Notes", "required": true,
				}},
			}},
		},
	}
	assertCode(t, doJSON(t, app, http.MethodPost, "/api/templates", templateBody, workerCookie), http.StatusForbidden, "forbidden")
	templateResponse := doJSON(t, app, http.MethodPost, "/api/templates", templateBody, adminOneCookie)
	assertStatus(t, templateResponse, http.StatusCreated)
	templateID := stringField(t, templateResponse, "id")

	emptyContent := map[string]any{"values": map[string]any{}, "parts": []any{}, "filledBy": "manual"}
	reportResponse := doJSON(t, app, http.MethodPost, "/api/reports", map[string]any{
		"templateId": templateID, "customerName": "Journey Customer", "content": emptyContent,
	}, workerCookie)
	assertStatus(t, reportResponse, http.StatusCreated)
	reportID := stringField(t, reportResponse, "id")
	assertCode(t, doJSON(t, app, http.MethodGet, "/api/reports/"+reportID, nil, adminTwoCookie), http.StatusNotFound, "not_found")

	completeContent := map[string]any{
		"values": map[string]any{"field_notes": "Completed safely"},
		"parts":  []any{}, "filledBy": "manual",
	}
	writeBody := map[string]any{"customerName": "Journey Customer", "content": completeContent}
	assertStatus(t, doJSON(t, app, http.MethodPut, "/api/reports/"+reportID, writeBody, workerCookie), http.StatusOK)
	assertStatus(t, doJSON(t, app, http.MethodPost, "/api/reports/"+reportID+"/save-and-export", writeBody, workerCookie), http.StatusOK)
	assertStatus(t, doJSON(t, app, http.MethodGet, "/api/reports/"+reportID+"/export", nil, workerCookie), http.StatusOK)
	assertStatus(t, doJSON(t, app, http.MethodGet, "/api/dashboard/templates", nil, workerCookie), http.StatusOK)
	tableResponse := doJSON(t, app, http.MethodGet, "/api/dashboard/templates/"+templateID, nil, workerCookie)
	assertStatus(t, tableResponse, http.StatusOK)
	if numberField(t, tableResponse, "total") != 1 {
		t.Fatalf("Worker dashboard total = %s", tableResponse.Body.String())
	}
	otherTable := doJSON(t, app, http.MethodGet, "/api/dashboard/templates/"+templateID, nil, adminTwoCookie)
	assertStatus(t, otherTable, http.StatusOK)
	if numberField(t, otherTable, "total") != 0 {
		t.Fatal("another user could see the Worker's report in dashboard history")
	}
	csvResponse := doJSON(t, app, http.MethodGet, "/api/dashboard/templates/"+templateID+"/export.csv", nil, workerCookie)
	assertStatus(t, csvResponse, http.StatusOK)
	if !strings.HasPrefix(csvResponse.Header().Get("Content-Type"), "text/csv") {
		t.Fatalf("CSV content type = %q", csvResponse.Header().Get("Content-Type"))
	}

	// Expiry, explicit revocation, and account deactivation all invalidate live sessions.
	expireSession(t, pool, workerCookie, "expires_at = now() - interval '1 minute'")
	assertCode(t, doJSON(t, app, http.MethodGet, "/auth/me", nil, workerCookie), http.StatusUnauthorized, "session_expired")
	workerCookie = login(t, app, workerCompany, nil)
	expireSession(t, pool, workerCookie, "revoked_at = now()")
	assertCode(t, doJSON(t, app, http.MethodGet, "/auth/me", nil, workerCookie), http.StatusUnauthorized, "session_expired")
	workerCookie = login(t, app, workerCompany, nil)
	assertStatus(t, doJSON(t, app, http.MethodPatch, "/api/admin/workers/"+workerID,
		map[string]any{"isActive": false}, adminOneCookie), http.StatusOK)
	assertCode(t, doJSON(t, app, http.MethodGet, "/auth/me", nil, workerCookie), http.StatusUnauthorized, "session_expired")
	inactiveLogin := doJSON(t, app, http.MethodPost, "/auth/login", map[string]any{
		"email": workerCompany, "password": journeyPassword,
	}, nil)
	assertCode(t, inactiveLogin, http.StatusForbidden, "inactive_account")

}

func openIsolatedStageBDatabase(t *testing.T) *sql.DB {
	t.Helper()
	testURL := os.Getenv("STAGE_B_TEST_DATABASE_URL")
	if testURL == "" {
		t.Skip("STAGE_B_TEST_DATABASE_URL not set; skipping Stage B HTTP integration journey")
	}

	admin, err := sql.Open("pgx", testURL)
	if err != nil {
		t.Fatalf("open PostgreSQL: %v", err)
	}
	if err := admin.Ping(); err != nil {
		_ = admin.Close()
		t.Fatalf("ping PostgreSQL: %v", err)
	}

	schema := "stage_b_" + strings.ReplaceAll(mustJourneyID(t), "-", "")
	if _, err := admin.Exec(`CREATE SCHEMA "` + schema + `"`); err != nil {
		_ = admin.Close()
		t.Fatalf("create isolated schema: %v", err)
	}

	parsed, err := url.Parse(testURL)
	if err != nil || parsed.Scheme == "" {
		_, _ = admin.Exec(`DROP SCHEMA "` + schema + `" CASCADE`)
		_ = admin.Close()
		t.Fatalf("STAGE_B_TEST_DATABASE_URL must be a PostgreSQL URL: %v", err)
	}
	query := parsed.Query()
	query.Set("search_path", schema+",public")
	parsed.RawQuery = query.Encode()

	pool, err := sql.Open("pgx", parsed.String())
	if err != nil {
		t.Fatalf("open isolated PostgreSQL schema: %v", err)
	}
	t.Cleanup(func() {
		_ = pool.Close()
		_, _ = admin.Exec(`DROP SCHEMA IF EXISTS "` + schema + `" CASCADE`)
		_ = admin.Close()
	})
	if err := database.Migrate(context.Background(), pool, migrations.SchemaFS); err != nil {
		t.Fatalf("apply production migration stream: %v", err)
	}
	return pool
}

func createAdminCode(t *testing.T, pool *sql.DB, store *accounts.PostgresStore, companyID, raw string, expiresAt time.Time, revoked bool) string {
	t.Helper()
	id := mustJourneyID(t)
	if err := store.CreateCompanyAdminCode(context.Background(), accounts.NewCompanyAdminCode{
		ID: id, CompanyID: companyID, CodeHash: security.HashSecret(raw), MaxUses: 1, ExpiresAt: expiresAt,
	}); err != nil {
		t.Fatalf("create company Admin code: %v", err)
	}
	if revoked {
		if _, err := pool.Exec(`UPDATE company_admin_codes SET revoked_at = now() WHERE id = $1`, id); err != nil {
			t.Fatalf("revoke company Admin code: %v", err)
		}
	}
	return raw
}

func registrationBody(role accounts.Role, name, company, personalEmail, companyEmail, code string) map[string]any {
	body := map[string]any{
		"fullName": name, "company": company, "phone": "+65 6123 4567",
		"personalEmail": personalEmail, "companyEmail": companyEmail,
		"password": journeyPassword, "role": role,
	}
	if role == accounts.RoleAdmin {
		body["companyAdminCode"] = code
	} else {
		body["joinCode"] = code
	}
	return body
}

func assertRegistrationCodeFailure(t *testing.T, app http.Handler, company, code, unique, wantCode string) {
	t.Helper()
	response := doJSON(t, app, http.MethodPost, "/auth/register", registrationBody(
		accounts.RoleAdmin, "Rejected User", company,
		unique+"@example.test", unique+"@company.test", code,
	), nil)
	assertCode(t, response, http.StatusUnprocessableEntity, wantCode)
}

func login(t *testing.T, app http.Handler, email string, oldCookie *http.Cookie) *http.Cookie {
	t.Helper()
	response := doJSON(t, app, http.MethodPost, "/auth/login", map[string]any{
		"email": email, "password": journeyPassword,
	}, oldCookie)
	assertStatus(t, response, http.StatusOK)
	return sessionCookie(t, response)
}

func expireSession(t *testing.T, pool *sql.DB, cookie *http.Cookie, assignment string) {
	t.Helper()
	if assignment != "expires_at = now() - interval '1 minute'" && assignment != "revoked_at = now()" {
		t.Fatalf("unsafe session test assignment %q", assignment)
	}
	query := `UPDATE sessions SET ` + assignment + ` WHERE token_hash = $1`
	result, err := pool.Exec(query, security.HashSecret(cookie.Value))
	if err != nil {
		t.Fatalf("invalidate session: %v", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		t.Fatalf("invalidated %d sessions, want 1", affected)
	}
}

func doJSON(t *testing.T, app http.Handler, method, path string, body any, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	var raw []byte
	if body != nil {
		raw = mustJSON(t, body)
	}
	return performRequest(app, method, path, raw, cookie)
}

func performRequest(app http.Handler, method, path string, body []byte, cookie *http.Cookie) *httptest.ResponseRecorder {
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	request.RemoteAddr = "192.0.2.25:43210"
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	app.ServeHTTP(response, request)
	return response
}

func mustJSON(t *testing.T, value any) []byte {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("marshal request: %v", err)
	}
	return raw
}

func assertStatus(t *testing.T, response *httptest.ResponseRecorder, want int) {
	t.Helper()
	if response.Code != want {
		t.Fatalf("status = %d, want %d: %s", response.Code, want, response.Body.String())
	}
}

func assertCode(t *testing.T, response *httptest.ResponseRecorder, status int, code string) {
	t.Helper()
	assertStatus(t, response, status)
	var body struct {
		Code string `json:"code"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode error response: %v: %s", err, response.Body.String())
	}
	if body.Code != code {
		t.Fatalf("error code = %q, want %q: %s", body.Code, code, response.Body.String())
	}
}

func sessionCookie(t *testing.T, response *httptest.ResponseRecorder) *http.Cookie {
	t.Helper()
	for _, cookie := range response.Result().Cookies() {
		if cookie.Name == auth.SessionCookieName && cookie.Value != "" {
			return cookie
		}
	}
	t.Fatalf("response has no %s cookie: %s", auth.SessionCookieName, response.Body.String())
	return nil
}

func responseObject(t *testing.T, response *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	var body map[string]any
	if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response object: %v: %s", err, response.Body.String())
	}
	return body
}

func stringField(t *testing.T, response *httptest.ResponseRecorder, field string) string {
	t.Helper()
	value, ok := responseObject(t, response)[field].(string)
	if !ok || value == "" {
		t.Fatalf("response field %q is not a non-empty string: %s", field, response.Body.String())
	}
	return value
}

func numberField(t *testing.T, response *httptest.ResponseRecorder, field string) int {
	t.Helper()
	value, ok := responseObject(t, response)[field].(float64)
	if !ok {
		t.Fatalf("response field %q is not a number: %s", field, response.Body.String())
	}
	return int(value)
}

func bodyContainsID(t *testing.T, response *httptest.ResponseRecorder, id string) bool {
	t.Helper()
	var rows []struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(response.Body.Bytes(), &rows); err != nil {
		t.Fatalf("decode response list: %v: %s", err, response.Body.String())
	}
	for _, row := range rows {
		if row.ID == id {
			return true
		}
	}
	return false
}

func mustJourneyID(t *testing.T) string {
	t.Helper()
	id, err := security.NewUUID()
	if err != nil {
		t.Fatalf("generate UUID: %v", err)
	}
	return id
}
