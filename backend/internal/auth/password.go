package auth

import (
	"errors"

	"golang.org/x/crypto/bcrypt"
)

// bcryptCost is the work factor for new hashes. bcrypt.DefaultCost (10) is the
// right call for a hackathon-scale deployment: comfortably above the range a
// commodity GPU chews through, and still a few milliseconds per login on the
// small Lightsail box the API runs on.
const bcryptCost = bcrypt.DefaultCost

// ErrInvalidCredentials is the single failure returned by the whole credential
// path — unknown email, empty stored hash, wrong password. One sentinel, so a
// caller cannot accidentally branch on which of the three it was and leak that
// distinction into a response. See the enumeration note in doc.go.
var ErrInvalidCredentials = errors.New("auth: invalid credentials")

// HashPassword returns a bcrypt hash of plaintext, suitable for storing in
// users.password_hash.
//
// NEVER log the argument or the result: the hash is offline-crackable material
// and the plaintext is the user's actual secret.
func HashPassword(plaintext string) (string, error) {
	if plaintext == "" {
		return "", errors.New("auth: refusing to hash an empty password")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(plaintext), bcryptCost)
	if err != nil {
		// The error from bcrypt names no secret material, but wrap it without
		// echoing either argument regardless.
		return "", errors.New("auth: hash password: " + err.Error())
	}
	return string(hash), nil
}

// VerifyPassword reports whether plaintext matches hash, returning nil on a
// match and ErrInvalidCredentials on anything else.
//
// The comparison is bcrypt's own CompareHashAndPassword, which is constant-time
// over the digest — rolling our own byte comparison here is exactly the mistake
// this API exists to prevent.
//
// An empty or malformed hash never verifies. That matters concretely: migration
// 0001 defaults users.password_hash to the empty string so dev users could be
// seeded without
// credentials, and an empty hash must read as "this account cannot be logged
// into", not as "any password works". bcrypt rejects it as too short, and the
// explicit guard below makes the intent unmissable rather than incidental.
func VerifyPassword(hash, plaintext string) error {
	if hash == "" {
		return ErrInvalidCredentials
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(plaintext)); err != nil {
		return ErrInvalidCredentials
	}
	return nil
}
