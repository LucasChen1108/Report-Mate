package auth

import (
	"context"
	"encoding/base64"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/accounts"
	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
	appmiddleware "github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
	"github.com/LucasChen1108/Report-Mate/backend/internal/security"
)

const (
	SessionCookieName = "reportmate_session"
	defaultSessionTTL = 24 * time.Hour
)

var errNoSessionCookie = errors.New("auth: no session cookie")

type SessionOptions struct {
	CookieName string
	Secure     bool
	TTL        time.Duration
}

func DefaultSessionOptions(secure bool) SessionOptions {
	return SessionOptions{CookieName: SessionCookieName, Secure: secure, TTL: defaultSessionTTL}
}

type authAccountContextKey struct{}
type authAttemptContextKey struct{}

type SessionAuthenticator struct {
	store   Store
	options SessionOptions
	now     func() time.Time
}

func NewSessionAuthenticator(store Store, options SessionOptions) *SessionAuthenticator {
	if options.CookieName == "" {
		options.CookieName = SessionCookieName
	}
	if options.TTL <= 0 {
		options.TTL = defaultSessionTTL
	}
	return &SessionAuthenticator{store: store, options: options, now: time.Now}
}

// Optional authenticates a valid cookie and attaches the current database
// principal. Public routes still run without a cookie; protected routes add
// Require, which turns missing or invalid sessions into a canonical 401.
func (a *SessionAuthenticator) Optional(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		principal, err := a.authenticate(r)
		if err != nil {
			if !errors.Is(err, errNoSessionCookie) {
				ctx := context.WithValue(r.Context(), authAttemptContextKey{}, err)
				r = r.WithContext(ctx)
			}
			next.ServeHTTP(w, r)
			return
		}
		next.ServeHTTP(w, r.WithContext(withSessionPrincipal(r.Context(), principal)))
	})
}

func (a *SessionAuthenticator) Require(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if _, ok := appmiddleware.PrincipalFromContext(r.Context()); ok {
			next.ServeHTTP(w, r)
			return
		}
		if priorErr, ok := r.Context().Value(authAttemptContextKey{}).(error); ok {
			writeAuthenticationFailure(w, priorErr)
			return
		}
		principal, err := a.authenticate(r)
		if err != nil {
			writeAuthenticationFailure(w, err)
			return
		}
		next.ServeHTTP(w, r.WithContext(withSessionPrincipal(r.Context(), principal)))
	})
}

func (a *SessionAuthenticator) authenticate(r *http.Request) (accounts.SessionPrincipal, error) {
	tokenHash, ok := a.TokenHash(r)
	if !ok {
		if _, err := r.Cookie(a.options.CookieName); errors.Is(err, http.ErrNoCookie) {
			return accounts.SessionPrincipal{}, errNoSessionCookie
		}
		return accounts.SessionPrincipal{}, accounts.ErrInvalidSession
	}
	return a.store.FindSession(r.Context(), tokenHash, a.now())
}

// TokenHash returns a digest only for tokens with the exact encoding and
// entropy width produced by security.GenerateOpaqueToken.
func (a *SessionAuthenticator) TokenHash(r *http.Request) ([]byte, bool) {
	cookie, err := r.Cookie(a.options.CookieName)
	if err != nil || cookie.Value == "" {
		return nil, false
	}
	raw, err := base64.RawURLEncoding.DecodeString(cookie.Value)
	if err != nil || len(raw) != 32 {
		return nil, false
	}
	return security.HashSecret(cookie.Value), true
}

func (a *SessionAuthenticator) SetCookie(w http.ResponseWriter, rawToken string, expiresAt, now time.Time) {
	http.SetCookie(w, &http.Cookie{
		Name: a.options.CookieName, Value: rawToken, Path: "/",
		Expires: expiresAt, MaxAge: int(expiresAt.Sub(now).Seconds()),
		HttpOnly: true, Secure: a.options.Secure, SameSite: http.SameSiteLaxMode,
	})
}

func (a *SessionAuthenticator) ClearCookie(w http.ResponseWriter) {
	http.SetCookie(w, &http.Cookie{
		Name: a.options.CookieName, Value: "", Path: "/",
		Expires: time.Unix(1, 0), MaxAge: -1,
		HttpOnly: true, Secure: a.options.Secure, SameSite: http.SameSiteLaxMode,
	})
}

func withSessionPrincipal(ctx context.Context, principal accounts.SessionPrincipal) context.Context {
	ctx = appmiddleware.WithPrincipal(ctx, appmiddleware.Principal{
		UserID: principal.Account.ID, Role: string(principal.Account.Role),
		CompanyID:      principal.Account.CompanyID,
		ManagerAdminID: principal.Account.ManagerAdminID,
	})
	return context.WithValue(ctx, authAccountContextKey{}, principal.Account)
}

func accountFromContext(ctx context.Context) (accounts.Account, bool) {
	account, ok := ctx.Value(authAccountContextKey{}).(accounts.Account)
	return account, ok
}

func writeAuthenticationFailure(w http.ResponseWriter, err error) {
	if errors.Is(err, accounts.ErrInvalidSession) {
		httpx.WriteError(w, http.StatusUnauthorized, "session_expired",
			"Your session is no longer valid. Please sign in again.")
		return
	}
	if errors.Is(err, errNoSessionCookie) {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthenticated",
			"You must be signed in to do that.")
		return
	}
	log.Printf("auth: session lookup failed: %v", err)
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error",
		"Something went wrong. Please try again.")
}
