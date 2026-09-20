package auth

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
)

// The stable machine-readable codes on this package's error bodies. They sit
// alongside httpx's "validation_error" in the same envelope shape.
const (
	codeInvalidCredentials = "invalid_credentials"
	codeUnauthorized       = "unauthorized"
)

// invalidCredentialsMessage is the ONE message the login route returns for
// every credential failure. Unknown email, empty stored hash, wrong password:
// same status, same code, same message, byte for byte. A route that said "no
// such user" for one and "wrong password" for the other would be a free
// account-enumeration oracle for anyone with a list of email addresses.
const invalidCredentialsMessage = "Invalid email or password."

// enumerationDecoyHash is a real bcrypt hash, compared against when the email
// is unknown so the response takes the same few milliseconds it would for a
// known account. Without it the timing difference between "returned before
// hashing" and "hashed, then failed" leaks exactly what the identical body
// above is there to hide. It is a hash of a random string nobody holds; no
// password verifies against it.
const enumerationDecoyHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

// Handler serves the /api/auth routes.
type Handler struct {
	store  Store
	issuer *TokenIssuer
}

// NewHandler returns a Handler reading users from store and signing with
// issuer.
func NewHandler(store Store, issuer *TokenIssuer) *Handler {
	return &Handler{store: store, issuer: issuer}
}

// RegisterRoutes mounts the auth routes onto mux, using Go 1.22+ method +
// pattern routing to match the rest of the backend.
//
// None of them is wrapped in an RBAC guard. /login and /logout are reachable
// without a token by definition, and /me does its own 401 — the identity
// middleware attaches a context identity but rejects nothing.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/auth/login", h.handleLogin)
	mux.HandleFunc("GET /api/auth/me", h.handleMe)
	mux.HandleFunc("POST /api/auth/logout", h.handleLogout)
}

// loginRequest is the POST /api/auth/login body.
type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

// loginResponse is what a successful login returns: the bearer token the
// frontend stores under TOKEN_STORAGE_KEY, and the user to seed AuthContext
// with so the first render after login needs no extra round trip.
type loginResponse struct {
	Token string `json:"token"`
	User  User   `json:"user"`
}

// handleLogin serves POST /api/auth/login.
//
// Every credential failure below writes the identical response through
// writeInvalidCredentials. Resist the urge to make any one of them more helpful.
func (h *Handler) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"The request body must be JSON with an email and a password.")
		return
	}

	email := strings.TrimSpace(req.Email)
	// A blank submission is a client-side mistake, not an enumeration probe,
	// but it still answers with the same body — a caller cannot learn anything
	// from it either way, and one response path is one fewer thing to keep in
	// sync.
	if email == "" || req.Password == "" {
		writeInvalidCredentials(w)
		return
	}

	user, passwordHash, err := h.store.FindByEmail(r.Context(), email)
	if err != nil {
		if !errors.Is(err, ErrUserNotFound) {
			// A real database failure. Log it (no email, no password) and
			// answer 500 — telling a caller "the database is down" is fine;
			// answering 401 here would be a lie that hides an outage.
			log.Printf("auth: login lookup failed: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
				"Something went wrong. Please try again.")
			return
		}
		// Unknown email: burn the same time a real comparison would, then
		// answer exactly as a wrong password does.
		_ = VerifyPassword(enumerationDecoyHash, req.Password)
		writeInvalidCredentials(w)
		return
	}

	if err := VerifyPassword(passwordHash, req.Password); err != nil {
		writeInvalidCredentials(w)
		return
	}

	token, _, err := h.issuer.Issue(user.ID, user.Role)
	if err != nil {
		log.Printf("auth: issue token: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Something went wrong. Please try again.")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, loginResponse{Token: token, User: user})
}

// handleMe serves GET /api/auth/me: the account behind the request's token, or
// 401 when the request carries no usable identity.
//
// It reads the id back out of the request context rather than re-parsing the
// header, so it validates the exact same thing every other handler sees. It
// then re-reads the user from the database instead of reconstructing them from
// the claims: a token outlives a deleted or renamed account, and /me is
// precisely where the frontend expects the truth (it is the mount-time check
// that decides whether a restored token is still good).
func (h *Handler) handleMe(w http.ResponseWriter, r *http.Request) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok {
		writeUnauthorized(w)
		return
	}

	user, err := h.store.FindByID(r.Context(), userID)
	if err != nil {
		if errors.Is(err, ErrUserNotFound) {
			// Valid signature, account gone. 401 so the client drops the token.
			writeUnauthorized(w)
			return
		}
		log.Printf("auth: me lookup failed: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Something went wrong. Please try again.")
		return
	}

	httpx.WriteJSON(w, http.StatusOK, user)
}

// handleLogout serves POST /api/auth/logout.
//
// It is honest about doing nothing server-side. These are stateless JWTs with
// no deny list, so signing out IS the client dropping its token; the route
// exists so the frontend has a symmetric call to make and so a future
// server-side revocation has an obvious place to live. It answers 204 for any
// caller, token or not — "you are signed out" is true either way.
func (h *Handler) handleLogout(w http.ResponseWriter, _ *http.Request) {
	w.WriteHeader(http.StatusNoContent)
}

// writeInvalidCredentials writes THE credential-failure response. Every login
// failure path calls this one function, which is what guarantees the responses
// are identical rather than merely similar.
func writeInvalidCredentials(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusUnauthorized, codeInvalidCredentials, invalidCredentialsMessage)
}

// writeUnauthorized writes the 401 for a request that carries no valid identity.
func writeUnauthorized(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusUnauthorized, codeUnauthorized,
		"You must be signed in to do that.")
}
