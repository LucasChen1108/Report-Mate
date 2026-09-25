package accountapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/accounts"
	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
	"github.com/LucasChen1108/Report-Mate/backend/internal/security"
)

var apiTestNow = time.Date(2026, 9, 22, 10, 0, 0, 0, time.UTC)

const (
	adminID  = "11111111-1111-4111-8111-111111111111"
	workerID = "22222222-2222-4222-8222-222222222222"
)

type fakeStore struct {
	profile           accounts.Account
	workers           []accounts.Account
	codes             []accounts.JoinCode
	err               error
	findID            string
	updateProfileID   string
	profileUpdate     accounts.ProfileUpdate
	listAdminID       string
	statusAdminID     string
	statusWorkerID    string
	statusActive      bool
	createCodeAdminID string
	createdCode       accounts.NewWorkerJoinCode
	listCodesAdminID  string
	revokeCodeAdminID string
	revokeCodeID      string
}

func testAdmin() accounts.Account {
	return accounts.Account{
		ID: adminID, FullName: "Alex Admin", CompanyID: "33333333-3333-4333-8333-333333333333",
		CompanyName: "Acme Services", Phone: "+65 6123 4567", PersonalEmail: "alex@example.com",
		CompanyEmail: "alex@acme.example", Role: accounts.RoleAdmin, IsActive: true,
	}
}

func testWorker() accounts.Account {
	admin := testAdmin()
	managerID := admin.ID
	return accounts.Account{
		ID: workerID, FullName: "Wendy Worker", CompanyID: admin.CompanyID,
		CompanyName: admin.CompanyName, Phone: "+65 6987 6543", PersonalEmail: "wendy@example.com",
		CompanyEmail: "wendy@acme.example", Role: accounts.RoleWorker, IsActive: true,
		ManagerAdminID: &managerID,
		LinkedAdmin:    &accounts.LinkedAdmin{ID: admin.ID, FullName: admin.FullName, CompanyEmail: admin.CompanyEmail},
	}
}

func newFakeStore() *fakeStore {
	worker := testWorker()
	return &fakeStore{
		profile: worker, workers: []accounts.Account{worker},
		codes: []accounts.JoinCode{{
			ID: "44444444-4444-4444-8444-444444444444", CompanyID: worker.CompanyID,
			CompanyName: worker.CompanyName, CreatedByAdminID: adminID,
			CreatedAt: apiTestNow.Add(-time.Hour), ExpiresAt: apiTestNow.Add(24 * time.Hour),
			Status: accounts.JoinCodeActive,
		}},
	}
}

func (s *fakeStore) FindByEmail(context.Context, string) (accounts.Account, error) {
	return s.profile, s.err
}
func (s *fakeStore) FindCredentialsByEmail(context.Context, string) (accounts.Credentials, error) {
	return accounts.Credentials{Account: s.profile}, s.err
}
func (s *fakeStore) FindByID(_ context.Context, id string) (accounts.Account, error) {
	s.findID = id
	return s.profile, s.err
}
func (s *fakeStore) UpdateProfile(_ context.Context, id string, update accounts.ProfileUpdate) (accounts.Account, error) {
	s.updateProfileID, s.profileUpdate = id, update
	if s.err != nil {
		return accounts.Account{}, s.err
	}
	s.profile.FullName, s.profile.Phone = strings.TrimSpace(update.FullName), accounts.NormalizePhone(update.Phone)
	s.profile.PersonalEmail = accounts.NormalizeEmail(update.PersonalEmail)
	return s.profile, nil
}
func (s *fakeStore) ListWorkers(_ context.Context, id string) ([]accounts.Account, error) {
	s.listAdminID = id
	return s.workers, s.err
}
func (s *fakeStore) UpdateWorkerStatus(_ context.Context, admin, worker string, active bool, _ time.Time) (accounts.Account, error) {
	s.statusAdminID, s.statusWorkerID, s.statusActive = admin, worker, active
	if s.err != nil {
		return accounts.Account{}, s.err
	}
	result := s.workers[0]
	result.IsActive = active
	return result, nil
}
func (s *fakeStore) CreateWorkerJoinCode(_ context.Context, admin string, input accounts.NewWorkerJoinCode, now time.Time) (accounts.JoinCode, error) {
	s.createCodeAdminID, s.createdCode = admin, input
	if s.err != nil {
		return accounts.JoinCode{}, s.err
	}
	return accounts.JoinCode{
		ID: input.ID, CompanyID: s.profile.CompanyID, CompanyName: s.profile.CompanyName,
		CreatedByAdminID: admin, CreatedAt: now, ExpiresAt: input.ExpiresAt, Status: accounts.JoinCodeActive,
	}, nil
}
func (s *fakeStore) ListWorkerJoinCodes(_ context.Context, admin string, _ time.Time) ([]accounts.JoinCode, error) {
	s.listCodesAdminID = admin
	return s.codes, s.err
}
func (s *fakeStore) RevokeWorkerJoinCode(_ context.Context, admin, code string, _ time.Time) (accounts.JoinCode, error) {
	s.revokeCodeAdminID, s.revokeCodeID = admin, code
	if s.err != nil {
		return accounts.JoinCode{}, s.err
	}
	result := s.codes[0]
	result.Status = accounts.JoinCodeRevoked
	return result, nil
}

func passthrough(next http.Handler) http.Handler { return next }

func newTestMux(store *fakeStore) (*Handler, *http.ServeMux) {
	handler := NewHandler(store, passthrough)
	handler.now = func() time.Time { return apiTestNow }
	handler.newID = func() (string, error) { return "55555555-5555-4555-8555-555555555555", nil }
	handler.newCode = func(string) (string, error) { return "WORKER-RAW-SECRET", nil }
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	return handler, mux
}

func requestWithPrincipal(method, path string, body []byte, principal middleware.Principal) *http.Request {
	request := httptest.NewRequest(method, path, bytes.NewReader(body))
	return request.WithContext(middleware.WithPrincipal(request.Context(), principal))
}

func adminPrincipal() middleware.Principal {
	return middleware.Principal{UserID: adminID, Role: adminRole, CompanyID: testAdmin().CompanyID}
}

func workerPrincipal() middleware.Principal {
	worker := testWorker()
	return middleware.Principal{UserID: worker.ID, Role: string(worker.Role), CompanyID: worker.CompanyID, ManagerAdminID: worker.ManagerAdminID}
}

func TestProfileIsSelfScopedAndRejectsForbiddenFields(t *testing.T) {
	store := newFakeStore()
	_, mux := newTestMux(store)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodGet, "/api/me", nil, workerPrincipal()))
	if response.Code != http.StatusOK || store.findID != workerID {
		t.Fatalf("GET response = %d %s; find id = %q", response.Code, response.Body.String(), store.findID)
	}
	if !strings.Contains(response.Body.String(), `"linkedAdmin":{"id":"`+adminID+`"`) {
		t.Fatalf("profile body = %s", response.Body.String())
	}

	response = httptest.NewRecorder()
	body := []byte(`{"fullName":"Changed","phone":"+65 6111 2222","personalEmail":"changed@example.com","companyName":"Other"}`)
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodPatch, "/api/me", body, workerPrincipal()))
	if response.Code != http.StatusBadRequest || store.updateProfileID != "" {
		t.Fatalf("forbidden-field response = %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	body = []byte(`{"fullName":" Changed Name ","phone":"+65 6111 2222","personalEmail":"CHANGED@EXAMPLE.COM"}`)
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodPatch, "/api/me", body, workerPrincipal()))
	if response.Code != http.StatusOK || store.updateProfileID != workerID || store.profileUpdate.PersonalEmail != "CHANGED@EXAMPLE.COM" {
		t.Fatalf("PATCH response = %d %s; update = %+v", response.Code, response.Body.String(), store.profileUpdate)
	}
}

func TestWorkerAndCodeRoutesRequireAdmin(t *testing.T) {
	store := newFakeStore()
	_, mux := newTestMux(store)
	paths := []struct{ method, path string }{
		{http.MethodGet, "/api/admin/workers"},
		{http.MethodPatch, "/api/admin/workers/" + workerID},
		{http.MethodGet, "/api/admin/join-codes"},
		{http.MethodPost, "/api/admin/join-codes"},
		{http.MethodDelete, "/api/admin/join-codes/44444444-4444-4444-8444-444444444444"},
	}
	for _, tc := range paths {
		response := httptest.NewRecorder()
		mux.ServeHTTP(response, requestWithPrincipal(tc.method, tc.path, []byte(`{}`), workerPrincipal()))
		if response.Code != http.StatusForbidden {
			t.Errorf("%s %s = %d: %s", tc.method, tc.path, response.Code, response.Body.String())
		}
	}
	if store.listAdminID != "" || store.statusAdminID != "" || store.createCodeAdminID != "" || store.listCodesAdminID != "" || store.revokeCodeAdminID != "" {
		t.Fatal("Worker request reached an Admin-scoped store method")
	}
}

func TestAdminWorkerOperationsUseAuthenticatedOwnerAndConcealMissing(t *testing.T) {
	store := newFakeStore()
	_, mux := newTestMux(store)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodGet, "/api/admin/workers", nil, adminPrincipal()))
	if response.Code != http.StatusOK || store.listAdminID != adminID || strings.Contains(response.Body.String(), "personalEmail") {
		t.Fatalf("list response = %d %s; admin = %q", response.Code, response.Body.String(), store.listAdminID)
	}

	response = httptest.NewRecorder()
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodPatch, "/api/admin/workers/"+workerID, []byte(`{"isActive":false}`), adminPrincipal()))
	if response.Code != http.StatusOK || store.statusAdminID != adminID || store.statusWorkerID != workerID || store.statusActive {
		t.Fatalf("status response = %d %s; owner=%q worker=%q", response.Code, response.Body.String(), store.statusAdminID, store.statusWorkerID)
	}

	store.err = accounts.ErrNotFound
	response = httptest.NewRecorder()
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodPatch, "/api/admin/workers/99999999-9999-4999-8999-999999999999", []byte(`{"isActive":true}`), adminPrincipal()))
	if response.Code != http.StatusNotFound || !strings.Contains(response.Body.String(), `"code":"not_found"`) {
		t.Fatalf("concealed response = %d %s", response.Code, response.Body.String())
	}
}

func TestGeneratedCodeIsReturnedOnceAndOnlyHashReachesStore(t *testing.T) {
	store := newFakeStore()
	_, mux := newTestMux(store)

	response := httptest.NewRecorder()
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodPost, "/api/admin/join-codes", []byte(`{}`), adminPrincipal()))
	if response.Code != http.StatusCreated || !strings.Contains(response.Body.String(), `"code":"WORKER-RAW-SECRET"`) {
		t.Fatalf("create response = %d %s", response.Code, response.Body.String())
	}
	if store.createCodeAdminID != adminID || string(store.createdCode.CodeHash) == "WORKER-RAW-SECRET" || !bytes.Equal(store.createdCode.CodeHash, security.HashSecret("WORKER-RAW-SECRET")) {
		t.Fatal("create store input did not contain only the code hash")
	}

	response = httptest.NewRecorder()
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodGet, "/api/admin/join-codes", nil, adminPrincipal()))
	if response.Code != http.StatusOK || store.listCodesAdminID != adminID || strings.Contains(response.Body.String(), `"code"`) {
		t.Fatalf("list response = %d %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodDelete, "/api/admin/join-codes/"+store.codes[0].ID, nil, adminPrincipal()))
	if response.Code != http.StatusOK || store.revokeCodeAdminID != adminID || store.revokeCodeID != store.codes[0].ID || strings.Contains(response.Body.String(), `"code"`) {
		t.Fatalf("revoke response = %d %s", response.Code, response.Body.String())
	}
}

func TestProfileConflictMapsToFrontendFieldError(t *testing.T) {
	store := newFakeStore()
	store.err = accounts.ErrEmailConflict
	_, mux := newTestMux(store)
	response := httptest.NewRecorder()
	body, _ := json.Marshal(profileUpdateRequest{FullName: "Name", Phone: "+65 6111 2222", PersonalEmail: "used@example.com"})
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodPatch, "/api/me", body, workerPrincipal()))
	if response.Code != http.StatusConflict || !strings.Contains(response.Body.String(), `"field":"personalEmail"`) {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
}

func TestUnexpectedStoreErrorIsGeneric(t *testing.T) {
	store := newFakeStore()
	store.err = errors.New("database detail")
	_, mux := newTestMux(store)
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, requestWithPrincipal(http.MethodGet, "/api/me", nil, workerPrincipal()))
	if response.Code != http.StatusInternalServerError || strings.Contains(response.Body.String(), "database detail") {
		t.Fatalf("response = %d %s", response.Code, response.Body.String())
	}
}
