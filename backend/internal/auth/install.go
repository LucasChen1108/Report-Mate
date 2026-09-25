package auth

import (
	"database/sql"
	"net/http"

	"github.com/LucasChen1108/Report-Mate/backend/internal/accounts"
)

// Install wires the canonical auth handlers and returns the session
// authenticator so other domain installers can protect their own routes.
func Install(mux *http.ServeMux, db *sql.DB, secureCookies bool) *SessionAuthenticator {
	store := accounts.NewPostgresStore(db)
	sessions := NewSessionAuthenticator(store, DefaultSessionOptions(secureCookies))
	NewHandler(store, sessions).RegisterRoutes(mux)
	return sessions
}
