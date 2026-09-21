package auth

import (
	"encoding/json"
	"errors"
	"log"
	"net"
	"net/http"
	"strings"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/accounts"
	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
	"github.com/LucasChen1108/Report-Mate/backend/internal/security"
)

const (
	codeInvalidCredentials = "invalid_credentials"
	codeInactiveAccount    = "inactive_account"
	codeRateLimited        = "rate_limited"
)

const (
	invalidCredentialsMessage = "Invalid email or password."
	inactiveAccountMessage    = "This account is inactive. Contact your administrator."
	defaultLoginLimit         = 5
	defaultLoginWindow        = time.Minute
)

// A real bcrypt comparison for unknown accounts keeps lookup timing close to
// the wrong-password path without disclosing an account's existence.
const enumerationDecoyHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

type Handler struct {
	store    Store
	sessions *SessionAuthenticator
	limiter  LoginLimiter
	now      func() time.Time
	newToken func() (string, error)
	newID    func() (string, error)
}

func NewHandler(store Store, sessions *SessionAuthenticator) *Handler {
	return &Handler{
		store:    store,
		sessions: sessions,
		limiter:  NewMemoryLoginLimiter(defaultLoginLimit, defaultLoginWindow),
		now:      time.Now,
		newToken: security.GenerateOpaqueToken,
		newID:    security.NewUUID,
	}
}

// RegisterRoutes exposes the canonical Stage A contract. Login and logout are
// public; /auth/me is explicitly protected so a missing or stale cookie gets a
// canonical 401 before the handler runs.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /auth/login", h.handleLogin)
	mux.Handle("GET /auth/me", h.sessions.Require(http.HandlerFunc(h.handleMe)))
	mux.HandleFunc("POST /auth/logout", h.handleLogout)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type authUser struct {
	ID            string        `json:"id"`
	FullName      string        `json:"fullName"`
	CompanyID     string        `json:"companyId"`
	CompanyName   string        `json:"companyName"`
	Phone         string        `json:"phone"`
	PersonalEmail string        `json:"personalEmail"`
	CompanyEmail  string        `json:"companyEmail"`
	Role          accounts.Role `json:"role"`
	IsActive      bool          `json:"isActive"`
}

func toAuthUser(account accounts.Account) authUser {
	return authUser{
		ID: account.ID, FullName: account.FullName,
		CompanyID: account.CompanyID, CompanyName: account.CompanyName,
		Phone: account.Phone, PersonalEmail: account.PersonalEmail,
		CompanyEmail: account.CompanyEmail, Role: account.Role,
		IsActive: account.IsActive,
	}
}

func (h *Handler) handleLogin(w http.ResponseWriter, r *http.Request) {
	var req loginRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"The request body must be JSON with an email and a password.")
		return
	}

	email := accounts.NormalizeEmail(req.Email)
	if email == "" || req.Password == "" {
		writeInvalidCredentials(w)
		return
	}

	now := h.now()
	if !h.limiter.Allow(loginRateLimitKey(r, email), now) {
		w.Header().Set("Retry-After", "60")
		httpx.WriteError(w, http.StatusTooManyRequests, codeRateLimited,
			"Too many login attempts. Please try again shortly.")
		return
	}

	credentials, err := h.store.FindCredentialsByEmail(r.Context(), email)
	if err != nil {
		if !errors.Is(err, accounts.ErrNotFound) {
			log.Printf("auth: login lookup failed: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
				"Something went wrong. Please try again.")
			return
		}
		_ = VerifyPassword(enumerationDecoyHash, req.Password)
		writeInvalidCredentials(w)
		return
	}
	if err := VerifyPassword(credentials.PasswordHash, req.Password); err != nil {
		writeInvalidCredentials(w)
		return
	}
	if !credentials.Account.IsActive {
		httpx.WriteError(w, http.StatusForbidden, codeInactiveAccount, inactiveAccountMessage)
		return
	}

	// A successful login replaces any session already presented by this
	// browser. Revocation happens before issuance so the old token cannot remain
	// valid if creating the replacement fails.
	if oldHash, ok := h.sessions.TokenHash(r); ok {
		if err := h.store.RevokeSession(r.Context(), oldHash, now); err != nil {
			log.Printf("auth: rotate session: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
				"Something went wrong. Please try again.")
			return
		}
	}

	rawToken, err := h.newToken()
	if err != nil {
		log.Printf("auth: generate session token: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Something went wrong. Please try again.")
		return
	}
	sessionID, err := h.newID()
	if err != nil {
		log.Printf("auth: generate session id: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Something went wrong. Please try again.")
		return
	}
	expiresAt := now.Add(h.sessions.options.TTL)
	if err := h.store.CreateSession(r.Context(), credentials.Account.ID, accounts.NewSession{
		ID: sessionID, TokenHash: security.HashSecret(rawToken), ExpiresAt: expiresAt,
	}, now); err != nil {
		log.Printf("auth: create session: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
			"Something went wrong. Please try again.")
		return
	}

	h.sessions.SetCookie(w, rawToken, expiresAt, now)
	httpx.WriteJSON(w, http.StatusOK, toAuthUser(credentials.Account))
}

func (h *Handler) handleMe(w http.ResponseWriter, r *http.Request) {
	account, ok := accountFromContext(r.Context())
	if !ok {
		writeAuthenticationFailure(w, errNoSessionCookie)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toAuthUser(account))
}

func (h *Handler) handleLogout(w http.ResponseWriter, r *http.Request) {
	now := h.now()
	tokenHash, ok := h.sessions.TokenHash(r)
	// Always clear the browser cookie, including for malformed, expired, or
	// already-revoked tokens. Logout remains idempotent.
	h.sessions.ClearCookie(w)
	if ok {
		if err := h.store.RevokeSession(r.Context(), tokenHash, now); err != nil {
			log.Printf("auth: revoke session: %v", err)
			httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
				"Something went wrong. Please try again.")
			return
		}
	}
	w.WriteHeader(http.StatusNoContent)
}

func loginRateLimitKey(r *http.Request, normalizedEmail string) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	return host + "|" + normalizedEmail
}

func writeInvalidCredentials(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusUnauthorized, codeInvalidCredentials, invalidCredentialsMessage)
}
