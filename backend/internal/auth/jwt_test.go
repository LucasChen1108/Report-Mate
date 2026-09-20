package auth

import (
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
)

// These tests lock in behaviour that was verified by hand against a live
// database and real HTTP, and never pinned in code. Nothing here is a new
// rule: every case below already passes. The point is that the next person to
// touch Parse — to add a claim, to loosen an option, to swap the library —
// finds out from a test run rather than from production.
//
// The four that matter most are the rejection paths, because they are the ones
// that fail OPEN if they regress: a tampered, expired, foreign-key or
// alg-none token that parses successfully is an authentication bypass, and it
// looks exactly like a working login until someone goes looking.

const testKey = "test-signing-key-not-the-production-one"

func newTestIssuer(t *testing.T) *TokenIssuer {
	t.Helper()
	issuer, err := NewTokenIssuer(testKey)
	if err != nil {
		t.Fatalf("NewTokenIssuer: %v", err)
	}
	return issuer
}

// signWith mints a token with arbitrary claims and an arbitrary key, which is
// how the rejection cases below forge the tokens Parse has to refuse. It
// deliberately does NOT go through Issue — Issue can only produce valid
// tokens, and a valid token proves nothing about the rejection paths.
func signWith(t *testing.T, key string, method jwt.SigningMethod, claims jwt.Claims) string {
	t.Helper()
	signed, err := jwt.NewWithClaims(method, claims).SignedString([]byte(key))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	return signed
}

func validClaims(sub, role string) Claims {
	now := time.Now()
	return Claims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   sub,
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
}

func TestNewTokenIssuerRejectsEmptyKey(t *testing.T) {
	// An empty key would sign every token with nothing, making them all
	// forgeable by anyone who noticed. It must fail at construction, not at
	// the first request.
	if _, err := NewTokenIssuer(""); err == nil {
		t.Fatal("NewTokenIssuer(\"\") succeeded, want an error")
	}
}

func TestIssueThenParseRoundTrips(t *testing.T) {
	issuer := newTestIssuer(t)

	const userID = "11111111-1111-1111-1111-111111111111"
	const role = "dispatcher_admin"

	token, expiresAt, err := issuer.Issue(userID, role)
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if token == "" {
		t.Fatal("Issue returned an empty token")
	}
	if !expiresAt.After(time.Now()) {
		t.Fatalf("expiresAt = %v, want a future instant", expiresAt)
	}

	claims, err := issuer.Parse(token)
	if err != nil {
		t.Fatalf("Parse of a freshly issued token: %v", err)
	}
	if claims.Subject != userID {
		t.Errorf("Subject = %q, want %q", claims.Subject, userID)
	}
	if claims.Role != role {
		t.Errorf("Role = %q, want %q", claims.Role, role)
	}
	if claims.ExpiresAt == nil {
		t.Fatal("ExpiresAt claim is missing")
	}
	// The returned expiry must be the one actually inside the token; a caller
	// telling the client one thing while the token says another is a bug that
	// only shows up as a mystery 401 a day later.
	if delta := claims.ExpiresAt.Time.Sub(expiresAt); delta > time.Second || delta < -time.Second {
		t.Errorf("token exp %v differs from the returned expiresAt %v", claims.ExpiresAt.Time, expiresAt)
	}
}

// TestParseRejects is the table the whole file exists for: every way a token
// can be untrustworthy, and the requirement that Parse says so.
func TestParseRejects(t *testing.T) {
	issuer := newTestIssuer(t)
	now := time.Now()

	// A genuine token, tampered with after signing: the payload segment is
	// re-encoded with an escalated role while the signature is left as-is.
	// This is the attack the HMAC exists to stop.
	tamperedPayload := func() string {
		valid := signWith(t, testKey, jwt.SigningMethodHS256, validClaims("user-1", "technician"))
		parts := strings.Split(valid, ".")
		if len(parts) != 3 {
			t.Fatalf("expected 3 JWT segments, got %d", len(parts))
		}
		escalated := signWith(t, testKey, jwt.SigningMethodHS256, validClaims("user-1", "dispatcher_admin"))
		escalatedParts := strings.Split(escalated, ".")
		// New payload, ORIGINAL signature.
		return escalatedParts[0] + "." + escalatedParts[1] + "." + parts[2]
	}()

	tests := []struct {
		name  string
		token string
		why   string
	}{
		{
			name:  "tampered payload",
			token: tamperedPayload,
			why:   "a re-encoded payload keeps the old signature, which no longer verifies",
		},
		{
			name: "expired",
			token: signWith(t, testKey, jwt.SigningMethodHS256, Claims{
				Role: "technician",
				RegisteredClaims: jwt.RegisteredClaims{
					Subject:   "user-1",
					IssuedAt:  jwt.NewNumericDate(now.Add(-48 * time.Hour)),
					ExpiresAt: jwt.NewNumericDate(now.Add(-24 * time.Hour)),
				},
			}),
			why: "expiry is the only revocation this service has; an expired token must stop working",
		},
		{
			name:  "signed with a different key",
			token: signWith(t, "a-completely-different-signing-key", jwt.SigningMethodHS256, validClaims("user-1", "dispatcher_admin")),
			why:   "a token minted by anyone else, or under a rotated key, is not ours",
		},
		{
			name: "no expiry claim",
			token: signWith(t, testKey, jwt.SigningMethodHS256, Claims{
				Role: "technician",
				RegisteredClaims: jwt.RegisteredClaims{
					Subject:  "user-1",
					IssuedAt: jwt.NewNumericDate(now),
				},
			}),
			why: "a token with no exp would never expire — WithExpirationRequired refuses it",
		},
		{
			name: "no subject claim",
			token: signWith(t, testKey, jwt.SigningMethodHS256, Claims{
				Role: "dispatcher_admin",
				RegisteredClaims: jwt.RegisteredClaims{
					IssuedAt:  jwt.NewNumericDate(now),
					ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
				},
			}),
			why: "sub is the identity every downstream handler reads; without it the token is unusable",
		},
		{
			name:  "alg none",
			token: unsignedNoneToken(t, "user-1", "dispatcher_admin", now.Add(time.Hour)),
			why:   "the classic bypass: drop the signature and declare the algorithm 'none'",
		},
		{
			name:  "empty string",
			token: "",
			why:   "not a token at all",
		},
		{
			name:  "not a jwt",
			token: "definitely-not-a-jwt",
			why:   "malformed input must be a rejection, not a panic",
		},
		{
			name:  "two segments only",
			token: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyLTEifQ",
			why:   "a token with no signature segment",
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			claims, err := issuer.Parse(tc.token)
			if err == nil {
				t.Fatalf("Parse accepted a %s token (%s); claims = %+v", tc.name, tc.why, claims)
			}
			// Every rejection is the same sentinel on purpose: a caller must
			// not be able to branch on WHY a token failed, and Middleware
			// treats them all identically.
			if !errors.Is(err, ErrInvalidToken) {
				t.Errorf("error = %v, want ErrInvalidToken", err)
			}
			if claims != nil {
				t.Errorf("claims = %+v on a rejection, want nil", claims)
			}
		})
	}
}

// unsignedNoneToken hand-builds an "alg": "none" token, because the jwt
// library refuses to sign one through the normal path — which is the whole
// reason an attacker has to hand-build it too.
func unsignedNoneToken(t *testing.T, sub, role string, expires time.Time) string {
	t.Helper()
	token := jwt.NewWithClaims(jwt.SigningMethodNone, Claims{
		Role: role,
		RegisteredClaims: jwt.RegisteredClaims{
			Subject:   sub,
			IssuedAt:  jwt.NewNumericDate(time.Now()),
			ExpiresAt: jwt.NewNumericDate(expires),
		},
	})
	signed, err := token.SignedString(jwt.UnsafeAllowNoneSignatureType)
	if err != nil {
		t.Fatalf("build alg-none token: %v", err)
	}
	return signed
}

// TestParseRejectsOtherHMACSizes guards the WithValidMethods pin specifically.
// HS384 and HS512 verify against the SAME shared secret, so without the
// algorithm allow-list a token re-signed under either would sail through —
// this is the narrow case a "check it's HMAC" keyfunc alone would miss.
func TestParseRejectsOtherHMACSizes(t *testing.T) {
	issuer := newTestIssuer(t)

	for _, method := range []jwt.SigningMethod{jwt.SigningMethodHS384, jwt.SigningMethodHS512} {
		t.Run(method.Alg(), func(t *testing.T) {
			token := signWith(t, testKey, method, validClaims("user-1", "dispatcher_admin"))
			if _, err := issuer.Parse(token); !errors.Is(err, ErrInvalidToken) {
				t.Fatalf("Parse accepted an %s token; error = %v, want ErrInvalidToken", method.Alg(), err)
			}
		})
	}
}

// TestParseRejectsTokensFromAnotherIssuer is the key-rotation case stated
// plainly: two issuers with different keys must not accept each other's
// tokens. AuthContext relies on this — it is what turns a token signed by a
// previous JWT_SIGNING_KEY into a clean 401 and a fresh login, rather than a
// half-valid session.
func TestParseRejectsTokensFromAnotherIssuer(t *testing.T) {
	mine := newTestIssuer(t)
	theirs, err := NewTokenIssuer("some-other-deployments-key")
	if err != nil {
		t.Fatalf("NewTokenIssuer: %v", err)
	}

	token, _, err := theirs.Issue("user-1", "dispatcher_admin")
	if err != nil {
		t.Fatalf("Issue: %v", err)
	}
	if _, err := mine.Parse(token); !errors.Is(err, ErrInvalidToken) {
		t.Fatalf("Parse accepted another issuer's token; error = %v", err)
	}
}
