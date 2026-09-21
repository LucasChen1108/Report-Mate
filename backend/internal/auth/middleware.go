package auth

import (
	"net/http"
	"strings"

	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
)

// bearerPrefix is the RFC 6750 scheme, matched case-insensitively because the
// scheme token in an Authorization header is not case-sensitive.
const bearerPrefix = "bearer "

// Middleware returns the request-context identity middleware — the replacement
// for the DevIdentity shim, occupying exactly the same seam.
//
// On a valid token it populates BOTH of the middleware package's identity
// accessors:
//
//	middleware.WithUserID(ctx, claims.Subject)  -> UserIDFromContext
//	middleware.WithRole(ctx, claims.Role)       -> RoleFromContext
//
// Both, always, together. RBAC reads the role and the report/dashboard handlers
// read the user id; populating one without the other produces a request that is
// half-authenticated in a way no handler is written to expect.
//
// IT NEVER REJECTS. No token, a malformed header, a tampered signature, an
// expired token, an "alg: none" token — all of them fall through to the next
// handler with the context untouched, carrying no identity. That is deliberate:
//
//   - middleware.RequireRole already answers 403 when no role is in context, so
//     the gated writes stay gated.
//   - the handlers that need an identity already answer 401 when no user id is
//     in context, so the owned-data routes stay protected.
//   - POST /api/auth/login has to be reachable with no token at all, and an
//     authenticating middleware that rejected would have to special-case it.
//
// Letting the existing per-route rules decide keeps one authorization policy in
// the codebase instead of two that can disagree.
func Middleware(issuer *TokenIssuer) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			token := bearerToken(r)
			if token == "" {
				next.ServeHTTP(w, r)
				return
			}

			claims, err := issuer.Parse(token)
			if err != nil {
				// Anonymous rather than rejected — see the note above. Not
				// logged either: a stream of invalid tokens is a client bug or
				// an attacker, and neither is worth writing token material to
				// the log for.
				next.ServeHTTP(w, r)
				return
			}

			ctx := middleware.WithUserID(r.Context(), claims.Subject)
			ctx = middleware.WithRole(ctx, claims.Role)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// bearerToken extracts the credential from an "Authorization: Bearer <token>"
// header, returning "" when the header is absent or is not a bearer header.
func bearerToken(r *http.Request) string {
	header := r.Header.Get("Authorization")
	if len(header) < len(bearerPrefix) {
		return ""
	}
	if !strings.EqualFold(header[:len(bearerPrefix)], bearerPrefix) {
		return ""
	}
	return strings.TrimSpace(header[len(bearerPrefix):])
}
