// Package middleware provides the cross-cutting HTTP layer.
//
// Four distinct pieces (not one blob):
//   - Auth check: validate the session/JWT on protected routes, reject
//     unauthenticated requests, attach the user identity to the request context.
//   - RBAC: restrict dispatcher-only routes (template management, dashboard)
//     to the dispatcher-admin role; reject wrong-role requests.
//   - Request logging: structured log line per request (method, path, status,
//     latency, user).
//   - Error formatting: centralize error responses into one consistent JSON
//     shape so handlers don't each invent their own.
//
// Order matters when wired in cmd/server: logging → auth → RBAC → handler,
// with error formatting wrapping the chain.
package middleware
