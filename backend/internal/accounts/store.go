package accounts

import (
	"context"
	"errors"
	"time"
)

var (
	ErrNotFound        = errors.New("accounts: not found")
	ErrConflict        = errors.New("accounts: conflict")
	ErrEmailConflict   = errors.New("accounts: email conflict")
	ErrInvalidCode     = errors.New("accounts: invalid code")
	ErrExpiredCode     = errors.New("accounts: expired code")
	ErrRevokedCode     = errors.New("accounts: revoked code")
	ErrUsedCode        = errors.New("accounts: used code")
	ErrCompanyMismatch = errors.New("accounts: company mismatch")
	ErrInvalidSession  = errors.New("accounts: invalid session")
)

type AccountRepository interface {
	FindByEmail(context.Context, string) (Account, error)
	FindCredentialsByEmail(context.Context, string) (Credentials, error)
	FindByID(context.Context, string) (Account, error)
	UpdateProfile(context.Context, string, ProfileUpdate) (Account, error)
}

type RegistrationRepository interface {
	RegisterAdmin(context.Context, NewAccount, []byte, NewSession, time.Time) (Account, error)
	RegisterWorker(context.Context, NewAccount, []byte, NewSession, time.Time) (Account, error)
}

type SessionRepository interface {
	CreateSession(context.Context, string, NewSession, time.Time) error
	FindSession(context.Context, []byte, time.Time) (SessionPrincipal, error)
	RevokeSession(context.Context, []byte, time.Time) error
	RevokeUserSessions(context.Context, string, time.Time) error
}

type WorkerRepository interface {
	ListWorkers(context.Context, string) ([]Account, error)
	UpdateWorkerStatus(context.Context, string, string, bool, time.Time) (Account, error)
	CreateWorkerJoinCode(context.Context, string, NewWorkerJoinCode, time.Time) (JoinCode, error)
	ListWorkerJoinCodes(context.Context, string, time.Time) ([]JoinCode, error)
	RevokeWorkerJoinCode(context.Context, string, string, time.Time) (JoinCode, error)
}

type ProvisioningRepository interface {
	CreateCompany(context.Context, Company) error
	CreateCompanyAdminCode(context.Context, NewCompanyAdminCode) error
}

type Store interface {
	AccountRepository
	RegistrationRepository
	SessionRepository
	WorkerRepository
	ProvisioningRepository
}
