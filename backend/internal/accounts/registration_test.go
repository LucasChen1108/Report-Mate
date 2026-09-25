package accounts

import (
	"errors"
	"testing"
	"time"
)

func TestAuthorizationCodeState(t *testing.T) {
	now := time.Date(2026, 9, 21, 12, 0, 0, 0, time.UTC)
	tests := []struct {
		name    string
		expires time.Time
		revoked bool
		used    bool
		want    error
	}{
		{name: "active", expires: now.Add(time.Minute)},
		{name: "expired", expires: now, want: ErrExpiredCode},
		{name: "revoked", expires: now.Add(time.Minute), revoked: true, want: ErrRevokedCode},
		{name: "used", expires: now.Add(time.Minute), used: true, want: ErrUsedCode},
		{name: "revocation takes precedence", expires: now.Add(-time.Minute), revoked: true, used: true, want: ErrRevokedCode},
	}

	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			err := authorizationCodeState(test.expires, test.revoked, test.used, now)
			if !errors.Is(err, test.want) {
				t.Fatalf("authorizationCodeState() error = %v, want %v", err, test.want)
			}
		})
	}
}
