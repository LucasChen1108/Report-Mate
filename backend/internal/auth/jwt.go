package auth

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// tokenTTL is how long an issued token stays valid. 24h is generous for a
// security-sensitive product and deliberately fine for this one: there is no
// refresh flow, and a shorter window would sign a field technician out
// mid-report. Revocation is "the token expires"; there is no deny list.
const tokenTTL = 24 * time.Hour

// signingMethod is the ONLY algorithm this service issues or accepts.
var signingMethod = jwt.SigningMethodHS256

// ErrInvalidToken is returned by Parse for every rejection — bad signature,
// wrong algorithm, expired, malformed, missing claims. Callers treat a token
// they cannot trust identically regardless of why, and Middleware simply
// proceeds without an identity.
var ErrInvalidToken = errors.New("auth: invalid token")

// Claims is the token payload: the registered claims (sub, exp, iat) plus the
// user's role.
//
// Role rides in the token so the RBAC middleware needs no database round trip
// per request. The tradeoff is real and accepted here: a role changed in the
// database does not take effect until the user's current token expires.
type Claims struct {
	Role string `json:"role"`
	jwt.RegisteredClaims
}

// TokenIssuer signs and validates the service's JWTs. Construct it once at
// startup and share it — it holds only the signing key and is safe for
// concurrent use.
type TokenIssuer struct {
	// key is the HMAC secret from JWT_SIGNING_KEY. SECRET — never log it and
	// never put it in an error message.
	key []byte
}

// NewTokenIssuer returns a TokenIssuer signing with signingKey. It errors on an
// empty key rather than silently signing with nothing, which would make every
// token forgeable by anyone who noticed.
func NewTokenIssuer(signingKey string) (*TokenIssuer, error) {
	if signingKey == "" {
		return nil, errors.New("auth: JWT signing key is empty")
	}
	return &TokenIssuer{key: []byte(signingKey)}, nil
}

// Issue returns a signed token for the given user id and role, along with the
// moment it expires (handy for a caller that wants to tell the client).
func (t *TokenIssuer) Issue(userID, role string) (string, time.Time, error) {
	now := time.Now()
	expiresAt := now.Add(tokenTTL)

	token := jwt.NewWithClaims(signingMethod, Claims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:  userID,
			IssuedAt: jwt.NewNumericDate(now),
			// ExpiresAt is what makes a stolen token stop working; the parser
			// below enforces it.
			ExpiresAt: jwt.NewNumericDate(expiresAt),
		},
	})

	signed, err := token.SignedString(t.key)
	if err != nil {
		return "", time.Time{}, fmt.Errorf("auth: sign token: %w", err)
	}
	return signed, expiresAt, nil
}

// Parse validates raw and returns its claims, or ErrInvalidToken.
//
// THE ALGORITHM CHECK IS THE POINT. jwt.WithValidMethods pins the accepted
// algorithm to HS256 before the signature is even examined, which is what
// defeats the two classic confusion attacks: a token re-headed as "alg: none"
// (no signature at all) and one re-headed as RS256 so the parser treats the
// HMAC secret as an RSA public key. The keyfunc re-checks the concrete method
// as a belt-and-braces second gate, because a future refactor that loosens the
// option list should still fail closed here.
func (t *TokenIssuer) Parse(raw string) (*Claims, error) {
	claims := &Claims{}

	_, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if _, ok := token.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("auth: unexpected signing method %q", token.Header["alg"])
		}
		return t.key, nil
	},
		jwt.WithValidMethods([]string{signingMethod.Alg()}),
		// Require the claims the rest of the stack depends on. A token with no
		// exp would never expire; one with no sub carries no identity.
		jwt.WithExpirationRequired(),
	)
	if err != nil {
		return nil, ErrInvalidToken
	}

	// Subject is the user id every downstream handler reads as the identity, so
	// a token without one is unusable even though it verified.
	if claims.Subject == "" {
		return nil, ErrInvalidToken
	}
	return claims, nil
}
