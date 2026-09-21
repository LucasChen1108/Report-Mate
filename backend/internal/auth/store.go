package auth

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ErrUserNotFound is returned when no users row matches the lookup.
//
// The handler maps this to the SAME response as a wrong password — see the
// enumeration note in doc.go. It stays a distinct sentinel here anyway, because
// "no such row" and "the password did not match" are genuinely different facts
// at this layer, and collapsing them inside the store would hide a real bug
// (a lookup failing when it should not) behind a credentials error.
var ErrUserNotFound = errors.New("auth: user not found")

// User is the account as the rest of the app sees it. It is JSON-encoded
// straight into the login and /me responses, so note what is NOT here:
// password_hash never enters this struct, which makes leaking it in a response
// impossible rather than merely unlikely.
//
// The field names match frontend/src/auth/AuthContext.tsx's AuthUser.
type User struct {
	ID    string `json:"id"`
	Name  string `json:"name"`
	Email string `json:"email"`
	Role  string `json:"role"`
}

// Store reads user accounts. An interface so the handler can be tested against
// a fake without a database.
type Store interface {
	// FindByEmail returns the user and their stored bcrypt hash. The hash is a
	// separate return value, not a User field, so it travels only as far as the
	// verification call.
	FindByEmail(ctx context.Context, email string) (User, string, error)
	// FindByID returns the user behind a validated token's subject.
	FindByID(ctx context.Context, id string) (User, error)
}

// PostgresStore is the database-backed Store.
type PostgresStore struct {
	db *sql.DB
}

// NewPostgresStore returns a Store reading from db.
func NewPostgresStore(db *sql.DB) *PostgresStore {
	return &PostgresStore{db: db}
}

// FindByEmail looks up a user by email address.
//
// No LOWER() and no normalization: users.email is CITEXT (migration 0001), so
// the equality below is already case-insensitive in the database. Wrapping the
// column in a function here would also defeat the unique index on it.
func (s *PostgresStore) FindByEmail(ctx context.Context, email string) (User, string, error) {
	const query = `
		SELECT id, name, email, role, password_hash
		FROM users
		WHERE email = $1`

	var user User
	var passwordHash string
	err := s.db.QueryRowContext(ctx, query, email).
		Scan(&user.ID, &user.Name, &user.Email, &user.Role, &passwordHash)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return User{}, "", ErrUserNotFound
	case err != nil:
		// Do not wrap the email into the error; it ends up in logs.
		return User{}, "", fmt.Errorf("auth: find user by email: %w", err)
	}
	return user, passwordHash, nil
}

// FindByID looks up a user by primary key. It is the /me path and the identity
// refresh behind a token: the token says who the caller claims to be, this
// confirms the account still exists.
//
// An id that is not a valid UUID makes Postgres raise a type error rather than
// returning no rows, so that case surfaces as a query error, not
// ErrUserNotFound. Callers treat both as "no usable identity".
func (s *PostgresStore) FindByID(ctx context.Context, id string) (User, error) {
	const query = `
		SELECT id, name, email, role
		FROM users
		WHERE id = $1`

	var user User
	err := s.db.QueryRowContext(ctx, query, id).
		Scan(&user.ID, &user.Name, &user.Email, &user.Role)
	switch {
	case errors.Is(err, sql.ErrNoRows):
		return User{}, ErrUserNotFound
	case err != nil:
		return User{}, fmt.Errorf("auth: find user by id: %w", err)
	}
	return user, nil
}
