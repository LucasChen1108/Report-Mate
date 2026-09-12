package middleware

import (
	"context"
	"encoding/json"
	"net/http"
)

// contextKey is an unexported type for context keys defined in this package.
// Using a distinct type prevents collisions with keys set by other packages.
type contextKey string

// roleContextKey is the context key under which the authenticated user's role
// is stored.
const roleContextKey contextKey = "middleware.role"

// WithRole returns a copy of ctx carrying the given authenticated user role.
//
// NOTE: The real auth middleware (package auth, owned separately) will be the
// production caller that populates the role into the request context after it
// validates the session/JWT. Until that middleware exists, this exported helper
// provides the seam: auth (or tests) call WithRole to attach the role, and
// RequireRole reads it back via RoleFromContext. This keeps RequireRole
// self-contained and testable now, with a clear integration point later.
func WithRole(ctx context.Context, role string) context.Context {
	return context.WithValue(ctx, roleContextKey, role)
}

// RoleFromContext reads the authenticated user's role from ctx. The boolean
// result is false when no role has been attached to the context.
func RoleFromContext(ctx context.Context) (string, bool) {
	role, ok := ctx.Value(roleContextKey).(string)
	return role, ok
}

// authorizationError is the JSON body returned when a request is rejected for
// lacking the required role. It mirrors the design's centralized error shape
// (a stable machine-readable code plus a human-readable message).
type authorizationError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// RequireRole returns middleware that permits a request to proceed only when
// the authenticated user's role (read from the request context, as populated by
// the auth middleware) matches role. When the role is absent from the context
// or does not match, it writes HTTP 403 with an authorization error and does
// not call the next handler.
//
// Read routes are typically left ungated; this is applied to write routes such
// as report_templates create/update to enforce the dispatcher-admin role
// (Requirements 6.1, 6.3).
func RequireRole(role string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			userRole, ok := RoleFromContext(r.Context())
			if !ok || userRole != role {
				writeForbidden(w, role)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// writeForbidden emits a 403 response with the authorization error JSON body,
// naming the role the request was missing.
func writeForbidden(w http.ResponseWriter, requiredRole string) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(http.StatusForbidden)
	// Best effort: if encoding fails the status line is already written.
	_ = json.NewEncoder(w).Encode(authorizationError{
		Code:    "authorization_error",
		Message: "requires the " + requiredRole + " role",
	})
}
