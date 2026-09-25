package auth

import (
	"github.com/LucasChen1108/Report-Mate/backend/internal/security"
)

// ErrInvalidCredentials is the single failure returned by the whole credential
// path — unknown email, empty stored hash, wrong password. One sentinel, so a
// caller cannot accidentally branch on which of the three it was and leak that
// distinction into a response. See the enumeration note in doc.go.
var ErrInvalidCredentials = security.ErrInvalidCredentials

// HashPassword returns a bcrypt hash of plaintext, suitable for storing in
// users.password_hash.
//
// NEVER log the argument or the result: the hash is offline-crackable material
// and the plaintext is the user's actual secret.
func HashPassword(plaintext string) (string, error) {
	return security.HashPassword(plaintext)
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
// seeded without credentials. An empty hash must read as "this account cannot
// be logged into", not as "any password works". bcrypt rejects it as too short,
// and the explicit guard makes the intent unmissable rather than incidental.
func VerifyPassword(hash, plaintext string) error {
	return security.VerifyPassword(hash, plaintext)
}
