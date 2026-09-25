package auth

import (
	"context"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/accounts"
)

// Store is the narrow persistence surface used by cookie authentication. It is
// implemented by accounts.PostgresStore so legacy users.email cannot become a
// second source of identity truth.
type Store interface {
	FindCredentialsByEmail(context.Context, string) (accounts.Credentials, error)
	RegisterAdmin(context.Context, accounts.NewAccount, []byte, accounts.NewSession, time.Time) (accounts.Account, error)
	RegisterWorker(context.Context, accounts.NewAccount, []byte, accounts.NewSession, time.Time) (accounts.Account, error)
	CreateSession(context.Context, string, accounts.NewSession, time.Time) error
	FindSession(context.Context, []byte, time.Time) (accounts.SessionPrincipal, error)
	RevokeSession(context.Context, []byte, time.Time) error
}
