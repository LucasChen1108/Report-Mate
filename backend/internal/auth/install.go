package auth

import (
	"database/sql"
	"net/http"
)

// Install wires the whole auth feature into a server: it builds the store, the
// token issuer and the handler, registers /api/auth/* on mux, and returns the
// identity middleware to wrap the mux with.
//
// WHY ONE FUNCTION INSTEAD OF FOUR LINES IN cmd/server. main.go is wiring-only
// and the auth feature is allowed exactly one line of it, replacing the
// DevIdentity shim it supersedes:
//
//	identity := auth.Install(mux, pool, cfg.JWTSigningKey)
//
// Everything auth needs to know about itself — that the handler needs the same
// issuer the middleware validates with, that the routes must be registered
// before the mux is wrapped — stays inside this package, where a change to it
// does not reach into the entrypoint.
//
// It panics on an empty signingKey rather than returning an error, which keeps
// the call site to one line and matches how cmd/server already treats an
// impossible-to-miss deployment mistake. config.Load is the guard that makes it
// unreachable in practice: it rejects a missing JWT_SIGNING_KEY in production
// and substitutes a development default otherwise, so reaching this panic means
// a caller bypassed config entirely.
func Install(mux *http.ServeMux, db *sql.DB, signingKey string) func(http.Handler) http.Handler {
	issuer, err := NewTokenIssuer(signingKey)
	if err != nil {
		panic("auth: " + err.Error() + " — JWT_SIGNING_KEY must be set")
	}

	NewHandler(NewPostgresStore(db), issuer).RegisterRoutes(mux)
	return Middleware(issuer)
}
