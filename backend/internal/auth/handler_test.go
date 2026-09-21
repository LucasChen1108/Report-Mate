package auth

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/accounts"
	appmiddleware "github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
	"github.com/LucasChen1108/Report-Mate/backend/internal/security"
)

const testPassword = "StrongPassword123"

var testNow = time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)

type fakeStore struct {
	credentials        accounts.Credentials
	credentialsErr     error
	lookupEmail        string
	sessions           map[string]accounts.SessionPrincipal
	revoked            map[string]bool
	findSessionCalls   int
	findSessionErr     error
	createdSession     accounts.NewSession
	createdSessionUser string
	revokeErr          error
}

func newFakeStore(t *testing.T) *fakeStore {
	t.Helper()
	hash, err := security.HashPassword(testPassword)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	return &fakeStore{
		credentials: accounts.Credentials{
			Account: accounts.Account{
				ID: "11111111-1111-4111-8111-111111111111", FullName: "Alex Admin",
				CompanyID: "22222222-2222-4222-8222-222222222222", CompanyName: "Acme Services",
				Phone: "+65 6123 4567", PersonalEmail: "alex@example.com",
				CompanyEmail: "alex@acme.example", Role: accounts.RoleAdmin, IsActive: true,
			},
			PasswordHash: hash,
		},
		sessions: make(map[string]accounts.SessionPrincipal),
		revoked:  make(map[string]bool),
	}
}

func (s *fakeStore) FindCredentialsByEmail(_ context.Context, email string) (accounts.Credentials, error) {
	s.lookupEmail = email
	if s.credentialsErr != nil {
		return accounts.Credentials{}, s.credentialsErr
	}
	return s.credentials, nil
}

func (s *fakeStore) CreateSession(_ context.Context, userID string, session accounts.NewSession, now time.Time) error {
	s.createdSessionUser = userID
	s.createdSession = session
	s.sessions[string(session.TokenHash)] = accounts.SessionPrincipal{
		Session: accounts.Session{ID: session.ID, UserID: userID, ExpiresAt: session.ExpiresAt, CreatedAt: now},
		Account: s.credentials.Account,
	}
	return nil
}

func (s *fakeStore) FindSession(_ context.Context, tokenHash []byte, now time.Time) (accounts.SessionPrincipal, error) {
	s.findSessionCalls++
	if s.findSessionErr != nil {
		return accounts.SessionPrincipal{}, s.findSessionErr
	}
	key := string(tokenHash)
	principal, ok := s.sessions[key]
	if !ok || s.revoked[key] || !principal.Session.ExpiresAt.After(now) || !principal.Account.IsActive {
		return accounts.SessionPrincipal{}, accounts.ErrInvalidSession
	}
	return principal, nil
}

func TestOptionalAndRequireReuseFailedSessionLookup(t *testing.T) {
	_, store, mux := newTestHandler(t, false)
	request := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookieName, Value: testRawToken(9)})
	response := httptest.NewRecorder()
	sessions := NewSessionAuthenticator(store, DefaultSessionOptions(false))
	sessions.now = func() time.Time { return testNow }
	sessions.Optional(mux).ServeHTTP(response, request)
	if response.Code != http.StatusUnauthorized {
		t.Fatalf("status = %d: %s", response.Code, response.Body.String())
	}
	if store.findSessionCalls != 1 {
		t.Fatalf("session lookups = %d, want 1", store.findSessionCalls)
	}
}

func TestSessionStoreFailureIsNotReportedAsExpiredSession(t *testing.T) {
	_, store, mux := newTestHandler(t, false)
	store.findSessionErr = errors.New("database unavailable")
	request := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookieName, Value: testRawToken(9)})
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError || !strings.Contains(response.Body.String(), `"code":"internal_error"`) {
		t.Fatalf("response = %d: %s", response.Code, response.Body.String())
	}
}

func (s *fakeStore) RevokeSession(_ context.Context, tokenHash []byte, _ time.Time) error {
	if s.revokeErr != nil {
		return s.revokeErr
	}
	s.revoked[string(tokenHash)] = true
	return nil
}

func testRawToken(fill byte) string {
	return base64.RawURLEncoding.EncodeToString(bytes.Repeat([]byte{fill}, 32))
}

func newTestHandler(t *testing.T, secure bool) (*Handler, *fakeStore, *http.ServeMux) {
	t.Helper()
	store := newFakeStore(t)
	sessions := NewSessionAuthenticator(store, DefaultSessionOptions(secure))
	sessions.now = func() time.Time { return testNow }
	handler := NewHandler(store, sessions)
	handler.now = func() time.Time { return testNow }
	handler.newToken = func() (string, error) { return testRawToken(7), nil }
	handler.newID = func() (string, error) { return "33333333-3333-4333-8333-333333333333", nil }
	mux := http.NewServeMux()
	handler.RegisterRoutes(mux)
	return handler, store, mux
}

func performLogin(t *testing.T, mux http.Handler, email, password string, cookie *http.Cookie) *httptest.ResponseRecorder {
	t.Helper()
	body, err := json.Marshal(loginRequest{Email: email, Password: password})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	request := httptest.NewRequest(http.MethodPost, "/auth/login", bytes.NewReader(body))
	request.RemoteAddr = "203.0.113.7:54321"
	if cookie != nil {
		request.AddCookie(cookie)
	}
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	return response
}

func TestLoginReturnsCanonicalUserAndHttpOnlyCookie(t *testing.T) {
	for _, tc := range []struct {
		name   string
		secure bool
	}{
		{name: "development", secure: false},
		{name: "production", secure: true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			_, store, mux := newTestHandler(t, tc.secure)
			response := performLogin(t, mux, "  ALEX@EXAMPLE.COM ", testPassword, nil)
			if response.Code != http.StatusOK {
				t.Fatalf("status = %d, body = %s", response.Code, response.Body.String())
			}
			if store.lookupEmail != "alex@example.com" {
				t.Errorf("lookup email = %q", store.lookupEmail)
			}

			var body map[string]any
			if err := json.Unmarshal(response.Body.Bytes(), &body); err != nil {
				t.Fatalf("Unmarshal: %v", err)
			}
			wantKeys := []string{"id", "fullName", "companyId", "companyName", "phone", "personalEmail", "companyEmail", "role", "isActive"}
			if len(body) != len(wantKeys) {
				t.Fatalf("response keys = %v", body)
			}
			for _, key := range wantKeys {
				if _, ok := body[key]; !ok {
					t.Errorf("missing response key %q", key)
				}
			}
			if _, ok := body["token"]; ok {
				t.Fatal("raw token appeared in JSON")
			}

			cookies := response.Result().Cookies()
			if len(cookies) != 1 {
				t.Fatalf("cookies = %d, want 1", len(cookies))
			}
			cookie := cookies[0]
			if cookie.Name != SessionCookieName || !cookie.HttpOnly || cookie.Secure != tc.secure || cookie.SameSite != http.SameSiteLaxMode || cookie.Path != "/" {
				t.Errorf("cookie = %+v", cookie)
			}
			if cookie.Value != testRawToken(7) {
				t.Error("cookie does not contain generated opaque token")
			}
			if string(store.createdSession.TokenHash) == cookie.Value {
				t.Fatal("raw token was persisted")
			}
			if !bytes.Equal(store.createdSession.TokenHash, security.HashSecret(cookie.Value)) {
				t.Fatal("persisted token hash does not match cookie digest")
			}
		})
	}
}

func TestLogoutRevokesSessionAndReplayReturnsUnauthorized(t *testing.T) {
	_, store, mux := newTestHandler(t, false)
	login := performLogin(t, mux, "alex@example.com", testPassword, nil)
	cookie := login.Result().Cookies()[0]

	meBefore := httptest.NewRecorder()
	request := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	request.AddCookie(cookie)
	mux.ServeHTTP(meBefore, request)
	if meBefore.Code != http.StatusOK {
		t.Fatalf("me before logout = %d: %s", meBefore.Code, meBefore.Body.String())
	}

	logout := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	request.AddCookie(cookie)
	mux.ServeHTTP(logout, request)
	if logout.Code != http.StatusNoContent {
		t.Fatalf("logout = %d: %s", logout.Code, logout.Body.String())
	}
	cleared := logout.Result().Cookies()[0]
	if cleared.Name != SessionCookieName || cleared.MaxAge != -1 || !cleared.HttpOnly {
		t.Errorf("cleared cookie = %+v", cleared)
	}
	if !store.revoked[string(security.HashSecret(cookie.Value))] {
		t.Fatal("database session was not revoked")
	}

	meAfter := httptest.NewRecorder()
	request = httptest.NewRequest(http.MethodGet, "/auth/me", nil)
	request.AddCookie(cookie)
	mux.ServeHTTP(meAfter, request)
	if meAfter.Code != http.StatusUnauthorized || !strings.Contains(meAfter.Body.String(), `"code":"session_expired"`) {
		t.Fatalf("replay = %d: %s", meAfter.Code, meAfter.Body.String())
	}
}

func TestMeRejectsMissingMalformedAndInvalidSessions(t *testing.T) {
	_, store, mux := newTestHandler(t, false)

	tests := []struct {
		name        string
		cookie      *http.Cookie
		wantCode    string
		wantLookups int
	}{
		{name: "missing", wantCode: "unauthenticated", wantLookups: 0},
		{name: "malformed", cookie: &http.Cookie{Name: SessionCookieName, Value: "not-a-valid-token"}, wantCode: "session_expired", wantLookups: 0},
		{name: "unknown or expired", cookie: &http.Cookie{Name: SessionCookieName, Value: testRawToken(9)}, wantCode: "session_expired", wantLookups: 1},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			store.findSessionCalls = 0
			request := httptest.NewRequest(http.MethodGet, "/auth/me", nil)
			if tc.cookie != nil {
				request.AddCookie(tc.cookie)
			}
			response := httptest.NewRecorder()
			mux.ServeHTTP(response, request)
			if response.Code != http.StatusUnauthorized || !strings.Contains(response.Body.String(), `"code":"`+tc.wantCode+`"`) {
				t.Fatalf("response = %d: %s", response.Code, response.Body.String())
			}
			if store.findSessionCalls != tc.wantLookups {
				t.Errorf("session lookups = %d, want %d", store.findSessionCalls, tc.wantLookups)
			}
		})
	}
}

func TestLoginCredentialFailuresAreIndistinguishable(t *testing.T) {
	_, wrongPasswordStore, wrongPasswordMux := newTestHandler(t, false)
	wrong := performLogin(t, wrongPasswordMux, "alex@example.com", "WrongPassword123", nil)

	_, unknownStore, unknownMux := newTestHandler(t, false)
	unknownStore.credentialsErr = accounts.ErrNotFound
	unknown := performLogin(t, unknownMux, "missing@example.com", "WrongPassword123", nil)

	if wrong.Code != http.StatusUnauthorized || unknown.Code != http.StatusUnauthorized || wrong.Body.String() != unknown.Body.String() {
		t.Fatalf("wrong=%d %q; unknown=%d %q", wrong.Code, wrong.Body.String(), unknown.Code, unknown.Body.String())
	}
	if wrongPasswordStore.createdSession.ID != "" || unknownStore.createdSession.ID != "" {
		t.Fatal("credential failure created a session")
	}
}

func TestInactiveAccountCannotLogin(t *testing.T) {
	_, store, mux := newTestHandler(t, false)
	store.credentials.Account.IsActive = false
	response := performLogin(t, mux, "alex@example.com", testPassword, nil)
	if response.Code != http.StatusForbidden || !strings.Contains(response.Body.String(), `"code":"inactive_account"`) {
		t.Fatalf("response = %d: %s", response.Code, response.Body.String())
	}
}

type denyLimiter struct{}

func (denyLimiter) Allow(string, time.Time) bool { return false }

func TestLoginRateLimitReturns429WithoutCredentialLookup(t *testing.T) {
	handler, store, mux := newTestHandler(t, false)
	handler.limiter = denyLimiter{}
	response := performLogin(t, mux, "alex@example.com", testPassword, nil)
	if response.Code != http.StatusTooManyRequests || !strings.Contains(response.Body.String(), `"code":"rate_limited"`) {
		t.Fatalf("response = %d: %s", response.Code, response.Body.String())
	}
	if store.lookupEmail != "" {
		t.Fatal("rate-limited request reached credential lookup")
	}
}

func TestSuccessfulLoginRotatesPresentedSession(t *testing.T) {
	_, store, mux := newTestHandler(t, false)
	oldToken := testRawToken(3)
	oldHash := security.HashSecret(oldToken)
	store.sessions[string(oldHash)] = accounts.SessionPrincipal{
		Session: accounts.Session{ID: "old", UserID: store.credentials.Account.ID, ExpiresAt: testNow.Add(time.Hour)},
		Account: store.credentials.Account,
	}
	response := performLogin(t, mux, "alex@example.com", testPassword, &http.Cookie{Name: SessionCookieName, Value: oldToken})
	if response.Code != http.StatusOK {
		t.Fatalf("response = %d: %s", response.Code, response.Body.String())
	}
	if !store.revoked[string(oldHash)] {
		t.Fatal("presented session was not revoked during rotation")
	}
}

func TestOptionalMiddlewareAttachesAuthoritativePrincipal(t *testing.T) {
	_, store, _ := newTestHandler(t, false)
	token := testRawToken(4)
	managerID := "44444444-4444-4444-8444-444444444444"
	account := store.credentials.Account
	account.ManagerAdminID = &managerID
	store.sessions[string(security.HashSecret(token))] = accounts.SessionPrincipal{
		Session: accounts.Session{ID: "session", UserID: account.ID, ExpiresAt: testNow.Add(time.Hour)},
		Account: account,
	}
	sessions := NewSessionAuthenticator(store, DefaultSessionOptions(false))
	sessions.now = func() time.Time { return testNow }

	next := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, ok := appmiddleware.PrincipalFromContext(r.Context())
		if !ok {
			t.Fatal("principal missing")
		}
		if principal.UserID != account.ID || principal.Role != string(account.Role) || principal.CompanyID != account.CompanyID || principal.ManagerAdminID == nil || *principal.ManagerAdminID != managerID {
			t.Errorf("principal = %+v", principal)
		}
		w.WriteHeader(http.StatusNoContent)
	})
	request := httptest.NewRequest(http.MethodGet, "/api/protected", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookieName, Value: token})
	response := httptest.NewRecorder()
	sessions.Optional(next).ServeHTTP(response, request)
	if response.Code != http.StatusNoContent {
		t.Fatalf("status = %d", response.Code)
	}
}

func TestLogoutStillClearsCookieWhenRevocationFails(t *testing.T) {
	_, store, mux := newTestHandler(t, true)
	store.revokeErr = errors.New("database unavailable")
	request := httptest.NewRequest(http.MethodPost, "/auth/logout", nil)
	request.AddCookie(&http.Cookie{Name: SessionCookieName, Value: testRawToken(2)})
	response := httptest.NewRecorder()
	mux.ServeHTTP(response, request)
	if response.Code != http.StatusInternalServerError {
		t.Fatalf("status = %d", response.Code)
	}
	cookies := response.Result().Cookies()
	if len(cookies) != 1 || cookies[0].MaxAge != -1 || !cookies[0].Secure {
		t.Fatalf("clear cookie = %+v", cookies)
	}
}
