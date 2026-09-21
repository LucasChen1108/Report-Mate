// Package auth authenticates requests with revocable, opaque cookie sessions.
//
// The browser receives the raw token only in an HttpOnly cookie. PostgreSQL
// stores its SHA-256 digest, and every authenticated request reloads the active
// account so deactivation, role changes, and ownership changes apply at once.
//
// The pieces:
//
//	password.go   bcrypt verification (never log a password or hash)
//	store.go      narrow account/session repository contract
//	middleware.go cookie validation and request-context identity
//	handler.go    POST /auth/login, GET /auth/me, POST /auth/logout
//	ratelimit.go process-local login attempt limiting
//	install.go    one call that wires the feature into cmd/server
//
// Optional middleware lets public routes run anonymously. Protected routes use
// Require, which rejects absent, malformed, expired, revoked, deleted-user, or
// inactive-user sessions with 401 before invoking the handler.
//
// A wrong password and an unknown email produce a byte-identical response, and
// the login path runs a bcrypt comparison even when no user was found, so
// neither the body nor the response time distinguishes the two.
package auth
