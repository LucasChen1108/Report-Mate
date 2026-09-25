// Package accounts defines the canonical Stage B account persistence boundary.
package accounts

import "time"

type Role string

const (
	RoleAdmin  Role = "dispatcher_admin"
	RoleWorker Role = "technician"
)

type LinkedAdmin struct {
	ID           string
	FullName     string
	CompanyEmail string
}

type Account struct {
	ID             string
	FullName       string
	CompanyID      string
	CompanyName    string
	Phone          string
	PersonalEmail  string
	CompanyEmail   string
	Role           Role
	IsActive       bool
	ManagerAdminID *string
	LinkedAdmin    *LinkedAdmin
}

// Credentials is deliberately separate from Account so ordinary profile,
// Worker, session, and response paths cannot serialize a password hash by
// passing an account value to a JSON encoder.
type Credentials struct {
	Account      Account
	PasswordHash string
}

type Company struct {
	ID             string
	Name           string
	NormalizedName string
}

type NewAccount struct {
	ID            string
	FullName      string
	Company       string
	Phone         string
	PersonalEmail string
	CompanyEmail  string
	PasswordHash  string
}

type NewSession struct {
	ID        string
	TokenHash []byte
	ExpiresAt time.Time
}

type Session struct {
	ID        string
	UserID    string
	ExpiresAt time.Time
	CreatedAt time.Time
}

type SessionPrincipal struct {
	Session Session
	Account Account
}

type NewCompanyAdminCode struct {
	ID        string
	CompanyID string
	CodeHash  []byte
	MaxUses   int
	ExpiresAt time.Time
}

type NewWorkerJoinCode struct {
	ID        string
	CodeHash  []byte
	ExpiresAt time.Time
}

type JoinCodeStatus string

const (
	JoinCodeActive  JoinCodeStatus = "active"
	JoinCodeExpired JoinCodeStatus = "expired"
	JoinCodeRevoked JoinCodeStatus = "revoked"
	JoinCodeUsed    JoinCodeStatus = "used"
)

type JoinCode struct {
	ID               string
	CompanyID        string
	CompanyName      string
	CreatedByAdminID string
	CreatedAt        time.Time
	ExpiresAt        time.Time
	Status           JoinCodeStatus
}

type ProfileUpdate struct {
	FullName      string
	Phone         string
	PersonalEmail string
}
