package middleware

import "context"

// userIDContextKey is the context key under which the authenticated user's id
// is stored. It reuses the unexported contextKey type declared in rbac.go, so
// identity keys stay collision-proof against other packages.
const userIDContextKey contextKey = "middleware.userID"

// principalContextKey carries the authoritative, database-backed identity for
// a request. Unlike the legacy JWT claims, these values are loaded from the
// current account on every authenticated request, so deactivation and role or
// ownership changes take effect immediately.
const principalContextKey contextKey = "middleware.principal"

// Principal is the minimum identity downstream authorization needs. Keep
// profile fields out of this value; handlers that need account data should use
// their repository rather than treating request context as a cache.
type Principal struct {
	UserID         string
	Role           string
	CompanyID      string
	ManagerAdminID *string
}

// WithPrincipal returns a context carrying an authoritative principal.
func WithPrincipal(ctx context.Context, principal Principal) context.Context {
	return context.WithValue(ctx, principalContextKey, principal)
}

// PrincipalFromContext returns the authenticated principal, when present.
func PrincipalFromContext(ctx context.Context) (Principal, bool) {
	principal, ok := ctx.Value(principalContextKey).(Principal)
	return principal, ok
}

// WithUserID returns a copy of ctx carrying the given authenticated user id.
//
// This is the identity counterpart to WithRole: RBAC needs "what may this
// request do", while the reports and dashboard handlers need "who is this" —
// to stamp service_reports.technician_id and to scope a technician to their own
// reports. The auth session middleware is the production caller.
//
// These two accessors used to live in devidentity.go alongside the development
// identity shim. The shim is gone; the seam it held open is not, so the
// accessors moved here rather than being deleted with it.
func WithUserID(ctx context.Context, userID string) context.Context {
	return context.WithValue(ctx, userIDContextKey, userID)
}

// UserIDFromContext reads the authenticated user's id from ctx. The boolean
// result is false when no id has been attached — handlers that need an identity
// must treat that as unauthenticated rather than substituting a default.
func UserIDFromContext(ctx context.Context) (string, bool) {
	if principal, ok := PrincipalFromContext(ctx); ok && principal.UserID != "" {
		return principal.UserID, true
	}
	userID, ok := ctx.Value(userIDContextKey).(string)
	return userID, ok
}
