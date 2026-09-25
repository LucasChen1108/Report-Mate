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
	codeValidationError    = "validation_error"
)

const (
	invalidCredentialsMessage = "Invalid email or password."
	inactiveAccountMessage    = "This account is inactive. Contact your administrator."
	defaultLoginLimit         = 5
	defaultLoginWindow        = time.Minute
	defaultRegisterLimit      = 5
	defaultRegisterWindow     = time.Minute
)

// A real bcrypt comparison for unknown accounts keeps lookup timing close to
// the wrong-password path without disclosing an account's existence.
const enumerationDecoyHash = "$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy"

type Handler struct {
	store           Store
	sessions        *SessionAuthenticator
	loginLimiter    AttemptLimiter
	registerLimiter AttemptLimiter
	now             func() time.Time
	newToken        func() (string, error)
	newID           func() (string, error)
}

func NewHandler(store Store, sessions *SessionAuthenticator) *Handler {
	return &Handler{
		store:           store,
		sessions:        sessions,
		loginLimiter:    NewMemoryAttemptLimiter(defaultLoginLimit, defaultLoginWindow),
		registerLimiter: NewMemoryAttemptLimiter(defaultRegisterLimit, defaultRegisterWindow),
		now:             time.Now,
		newToken:        security.GenerateOpaqueToken,
		newID:           security.NewUUID,
	}
}

// RegisterRoutes exposes the canonical Stage A contract. Login and logout are
// public; /auth/me is explicitly protected so a missing or stale cookie gets a
// canonical 401 before the handler runs.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /auth/login", h.handleLogin)
	mux.HandleFunc("POST /auth/register", h.handleRegister)
	mux.Handle("GET /auth/me", h.sessions.Require(http.HandlerFunc(h.handleMe)))
	mux.HandleFunc("POST /auth/logout", h.handleLogout)
}

type loginRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
}

type registrationRequest struct {
	FullName         string        `json:"fullName"`
	Company          string        `json:"company"`
	Phone            string        `json:"phone"`
	PersonalEmail    string        `json:"personalEmail"`
	CompanyEmail     string        `json:"companyEmail"`
	Password         string        `json:"password"`
	Role             accounts.Role `json:"role"`
	CompanyAdminCode string        `json:"companyAdminCode"`
	JoinCode         string        `json:"joinCode"`
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
	if !h.loginLimiter.Allow(attemptRateLimitKey(r, email), now) {
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

func (h *Handler) handleRegister(w http.ResponseWriter, r *http.Request) {
	var req registrationRequest
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "invalid_request",
			"The request body must contain valid registration details.")
		return
	}

	personalEmail := accounts.NormalizeEmail(req.PersonalEmail)
	companyEmail := accounts.NormalizeEmail(req.CompanyEmail)
	now := h.now()
	if !h.registerLimiter.Allow(attemptRateLimitKey(r, personalEmail+"|"+companyEmail), now) {
		w.Header().Set("Retry-After", "60")
		httpx.WriteError(w, http.StatusTooManyRequests, codeRateLimited,
			"Too many registration attempts. Please try again shortly.")
		return
	}

	code, codeField, validShape := registrationCode(req)
	if !validShape {
		writeFieldError(w, http.StatusUnprocessableEntity, codeValidationError,
			"Select an account type and provide its required authorization code.", codeField)
		return
	}

	passwordHash, err := security.HashPassword(req.Password)
	if err != nil {
		if errors.Is(err, security.ErrWeakPassword) {
			writeFieldError(w, http.StatusUnprocessableEntity, codeValidationError,
				"Password must be at least 12 characters and include uppercase, lowercase, and a number.", "password")
			return
		}
		log.Printf("auth: hash registration password: %v", err)
		writeInternalError(w)
		return
	}

	accountID, err := h.newID()
	if err != nil {
		log.Printf("auth: generate account id: %v", err)
		writeInternalError(w)
		return
	}
	sessionID, err := h.newID()
	if err != nil {
		log.Printf("auth: generate registration session id: %v", err)
		writeInternalError(w)
		return
	}
	rawToken, err := h.newToken()
	if err != nil {
		log.Printf("auth: generate registration session token: %v", err)
		writeInternalError(w)
		return
	}
	expiresAt := now.Add(h.sessions.options.TTL)
	input := accounts.NewAccount{
		ID: accountID, FullName: req.FullName, Company: req.Company,
		Phone: req.Phone, PersonalEmail: personalEmail, CompanyEmail: companyEmail,
		PasswordHash: passwordHash,
	}
	if err := accounts.ValidateNewAccount(input); err != nil {
		writeFieldError(w, http.StatusUnprocessableEntity, codeValidationError,
			"Check the name, company, phone number, and email addresses and try again.", "")
		return
	}
	session := accounts.NewSession{
		ID: sessionID, TokenHash: security.HashSecret(rawToken), ExpiresAt: expiresAt,
	}
	codeHash := security.HashSecret(strings.TrimSpace(code))
	var account accounts.Account
	if req.Role == accounts.RoleAdmin {
		account, err = h.store.RegisterAdmin(r.Context(), input, codeHash, session, now)
	} else {
		account, err = h.store.RegisterWorker(r.Context(), input, codeHash, session, now)
	}
	if err != nil {
		h.writeRegistrationError(w, err, codeField)
		return
	}

	h.sessions.SetCookie(w, rawToken, expiresAt, now)
	httpx.WriteJSON(w, http.StatusCreated, toAuthUser(account))
}

func registrationCode(req registrationRequest) (code, field string, ok bool) {
	switch req.Role {
	case accounts.RoleAdmin:
		return req.CompanyAdminCode, "companyAdminCode",
			strings.TrimSpace(req.CompanyAdminCode) != "" && strings.TrimSpace(req.JoinCode) == ""
	case accounts.RoleWorker:
		return req.JoinCode, "joinCode",
			strings.TrimSpace(req.JoinCode) != "" && strings.TrimSpace(req.CompanyAdminCode) == ""
	default:
		return "", "role", false
	}
}

func (h *Handler) writeRegistrationError(w http.ResponseWriter, err error, codeField string) {
	switch {
	case errors.Is(err, accounts.ErrInvalidCode):
		writeFieldError(w, http.StatusUnprocessableEntity, "invalid_code", "That authorization code is invalid.", codeField)
	case errors.Is(err, accounts.ErrExpiredCode):
		writeFieldError(w, http.StatusUnprocessableEntity, "expired_code", "That authorization code has expired.", codeField)
	case errors.Is(err, accounts.ErrRevokedCode):
		writeFieldError(w, http.StatusUnprocessableEntity, "revoked_code", "That authorization code was revoked.", codeField)
	case errors.Is(err, accounts.ErrUsedCode):
		writeFieldError(w, http.StatusUnprocessableEntity, "used_code", "That authorization code has already been used.", codeField)
	case errors.Is(err, accounts.ErrCompanyMismatch):
		writeFieldError(w, http.StatusUnprocessableEntity, "company_mismatch", "That authorization code does not match the company.", "company")
	case errors.Is(err, accounts.ErrEmailConflict), errors.Is(err, accounts.ErrConflict):
		writeFieldError(w, http.StatusConflict, "conflict", "An account already uses one of those email addresses.", "email")
	case errors.Is(err, accounts.ErrValidation):
		writeFieldError(w, http.StatusUnprocessableEntity, codeValidationError, "Check the registration details and try again.", "")
	default:
		log.Printf("auth: register account: %v", err)
		writeInternalError(w)
	}
}

type fieldErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func writeFieldError(w http.ResponseWriter, status int, code, message, field string) {
	httpx.WriteJSON(w, status, fieldErrorBody{Code: code, Message: message, Field: field})
}

func writeInternalError(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
		"Something went wrong. Please try again.")
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

func attemptRateLimitKey(r *http.Request, normalizedEmail string) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = strings.TrimSpace(r.RemoteAddr)
	}
	return host + "|" + normalizedEmail
}

func writeInvalidCredentials(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusUnauthorized, codeInvalidCredentials, invalidCredentialsMessage)
}
