package middleware

import "context"

// userIDContextKey is the context key under which the authenticated user's id
// is stored. It reuses the unexported contextKey type declared in rbac.go, so
// identity keys stay collision-proof against other packages.
const userIDContextKey contextKey = "middleware.userID"

// WithUserID returns a copy of ctx carrying the given authenticated user id.
//
// This is the identity counterpart to WithRole: RBAC needs "what may this
// request do", while the reports and dashboard handlers need "who is this" —
// to stamp service_reports.technician_id and to scope a technician to their own
// reports. auth.Middleware is the production caller that populates both after
// validating the request's JWT.
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
	userID, ok := ctx.Value(userIDContextKey).(string)
	return userID, ok
}
