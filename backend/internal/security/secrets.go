// Package security owns password, opaque-token, authorization-code, and ID
// primitives shared by account stores and authentication handlers.
package security

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"errors"
	"fmt"
	"strings"

	"golang.org/x/crypto/bcrypt"
)

const (
	bcryptCost        = bcrypt.DefaultCost
	PasswordMinLength = 12
	secretBytes       = 32
)

var (
	ErrInvalidCredentials = errors.New("security: invalid credentials")
	ErrWeakPassword       = errors.New("security: password does not meet requirements")
)

func ValidatePassword(plaintext string) error {
	if len(plaintext) < PasswordMinLength ||
		!strings.ContainsAny(plaintext, "abcdefghijklmnopqrstuvwxyz") ||
		!strings.ContainsAny(plaintext, "ABCDEFGHIJKLMNOPQRSTUVWXYZ") ||
		!strings.ContainsAny(plaintext, "0123456789") {
		return ErrWeakPassword
	}
	return nil
}

func HashPassword(plaintext string) (string, error) {
	if err := ValidatePassword(plaintext); err != nil {
		return "", err
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plaintext), bcryptCost)
	if err != nil {
		return "", fmt.Errorf("security: hash password: %w", err)
	}
	return string(hash), nil
}

func VerifyPassword(hash, plaintext string) error {
	if hash == "" {
		return ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plaintext)); err != nil {
		return ErrInvalidCredentials
	}
	return nil
}

// GenerateOpaqueToken returns a browser-cookie-safe token with 256 bits of
// entropy. Only HashSecret(token) may be persisted.
func GenerateOpaqueToken() (string, error) {
	raw, err := randomBytes(secretBytes)
	if err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(raw), nil
}

// GenerateAuthorizationCode returns an uppercase, unpadded code. The prefix is
// public metadata that helps people distinguish Admin and Worker codes; the
// random portion carries the entropy.
func GenerateAuthorizationCode(prefix string) (string, error) {
	raw, err := randomBytes(20)
	if err != nil {
		return "", err
	}
	encoded := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(raw)
	prefix = strings.ToUpper(strings.TrimSpace(prefix))
	if prefix == "" {
		return encoded, nil
	}
	return prefix + "-" + encoded, nil
}

// HashSecret returns the fixed-width digest stored for a session token or
// authorization code.
func HashSecret(raw string) []byte {
	digest := sha256.Sum256([]byte(raw))
	return digest[:]
}

// NewUUID returns an RFC 4122 version-4 UUID without relying on a PostgreSQL
// extension or an additional module.
func NewUUID() (string, error) {
	raw, err := randomBytes(16)
	if err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	return fmt.Sprintf(
		"%08x-%04x-%04x-%04x-%012x",
		raw[0:4], raw[4:6], raw[6:8], raw[8:10], raw[10:16],
	), nil
}

func randomBytes(size int) ([]byte, error) {
	raw := make([]byte, size)
	if _, err := rand.Read(raw); err != nil {
		return nil, fmt.Errorf("security: generate random value: %w", err)
	}
	return raw, nil
}
