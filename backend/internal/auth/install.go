package auth

import (
	"database/sql"
	"net/http"

	"github.com/LucasChen1108/Report-Mate/backend/internal/accounts"
)

// Install wires the canonical auth handlers and returns optional session
// middleware for the application mux. Individual protected routes must also
// use SessionAuthenticator.Require (the auth package does this for /auth/me;
// the remaining domains are unified in Stage B Commit 7).
func Install(mux *http.ServeMux, db *sql.DB, secureCookies bool) func(http.Handler) http.Handler {
	store := accounts.NewPostgresStore(db)
	sessions := NewSessionAuthenticator(store, DefaultSessionOptions(secureCookies))
	NewHandler(store, sessions).RegisterRoutes(mux)
	return sessions.Optional
}
