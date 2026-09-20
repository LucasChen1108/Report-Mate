package auth

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
)

// The middleware's contract has two halves, and both are easy to break
// silently:
//
//  1. A GOOD token populates BOTH identity accessors, together. RBAC reads the
//     role and the report/dashboard handlers read the user id; populating one
//     without the other produces a request that is half-authenticated in a way
//     no handler is written to expect.
//
//  2. A BAD token leaves the context UNTOUCHED and calls the next handler
//     anyway. That is deliberate (see Middleware's doc comment) and it is the
//     part most likely to be "fixed" by someone who reads it as a bug — so it
//     is pinned here, with the reason attached.
//
// The failure mode if (2) regresses toward rejecting is that POST
// /api/auth/login stops being reachable without a token, i.e. nobody can log
// in. The failure mode if (2) regresses toward trusting is an auth bypass.

// captureIdentity is the terminal handler: it records what the middleware put
// in the request context, and that it ran at all.
type captureIdentity struct {
	called  bool
	userID  string
	hasUser bool
	role    string
	hasRole bool
}

func (c *captureIdentity) ServeHTTP(_ http.ResponseWriter, r *http.Request) {
	c.called = true
	c.userID, c.hasUser = middleware.UserIDFromContext(r.Context())
	c.role, c.hasRole = middleware.RoleFromContext(r.Context())
}

func serveWithAuthHeader(t *testing.T, issuer *TokenIssuer, header string) *captureIdentity {
	t.Helper()
	next := &captureIdentity{}
	request := httptest.NewRequest("GET", "/api/anything", nil)
	if header != "" {
		request.Header.Set("Authorization", header)
	}
	Middleware(issuer)(next).ServeHTTP(httptest.NewRecorder(), request)
	if !next.called {
		t.Fatal("middleware did not call the next handler — it must never reject")
	}
	return next
}

func TestMiddlewarePopulatesIdentityFromAValidToken(t *testing.T) {
	issuer := newTestIssuer(t)
	const userID = "22222222-2222-2222-2222-222222222222"
	const role = "dispatcher_admin"

	token, _, err := issuer.Issue(userID, role)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	got := serveWithAuthHeader(t, issuer, "Bearer "+token)

	if !got.hasUser || got.userID != userID {
		t.Errorf("user id = %q (present=%v), want %q", got.userID, got.hasUser, userID)
	}
	if !got.hasRole || got.role != role {
		t.Errorf("role = %q (present=%v), want %q", got.role, got.hasRole, role)
	}
}

// TestMiddlewareAcceptsAnyBearerCasing: the scheme token in an Authorization
// header is not case-sensitive per RFC 7235, and clients do vary.
func TestMiddlewareAcceptsAnyBearerCasing(t *testing.T) {
	issuer := newTestIssuer(t)
	token, _, err := issuer.Issue("user-1", "technician")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}

	for _, scheme := range []string{"Bearer", "bearer", "BEARER", "BeArEr"} {
		t.Run(scheme, func(t *testing.T) {
			got := serveWithAuthHeader(t, issuer, scheme+" "+token)
			if !got.hasUser {
				t.Errorf("no identity for scheme %q", scheme)
			}
		})
	}
}

// TestMiddlewareLeavesContextAnonymous is the table of everything that must
// produce an ANONYMOUS request rather than a rejected one. The per-route rules
// (middleware.RequireRole -> 403, the handlers' requireUser -> 401) are what
// turn anonymity into the right status code; this layer only declines to
// vouch for the caller.
func TestMiddlewareLeavesContextAnonymous(t *testing.T) {
	issuer := newTestIssuer(t)

	now := time.Now()
	expired := signWith(t, testKey, jwt.SigningMethodHS256, Claims{
		Role: "dispatcher_admin",
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   "user-1",
			IssuedAt:  jwt.NewNumericDate(now.Add(-48 * time.Hour)),
			ExpiresAt: jwt.NewNumericDate(now.Add(-24 * time.Hour)),
		},
	})
	foreignKey := signWith(t, "another-deployments-key", jwt.SigningMethodHS256, validClaims("user-1", "dispatcher_admin"))
	algNone := unsignedNoneToken(t, "user-1", "dispatcher_admin", now.Add(time.Hour))

	tests := []struct {
		name   string
		header string
	}{
		{name: "no header at all", header: ""},
		{name: "empty bearer", header: "Bearer "},
		{name: "bearer with whitespace only", header: "Bearer    "},
		{name: "a different auth scheme", header: "Basic dXNlcjpwYXNz"},
		{name: "no scheme, bare token", header: foreignKey},
		{name: "garbage token", header: "Bearer not-a-jwt"},
		{name: "expired token", header: "Bearer " + expired},
		{name: "token signed with another key", header: "Bearer " + foreignKey},
		{name: "alg none token", header: "Bearer " + algNone},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			got := serveWithAuthHeader(t, issuer, tc.header)
			if got.hasUser {
				t.Errorf("user id %q was put in the context, want anonymous", got.userID)
			}
			if got.hasRole {
				t.Errorf("role %q was put in the context, want anonymous", got.role)
			}
		})
	}
}
