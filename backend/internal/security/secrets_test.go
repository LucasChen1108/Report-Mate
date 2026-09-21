package security

import (
	"bytes"
	"errors"
	"regexp"
	"testing"
)

func TestPasswordValidationHashAndVerification(t *testing.T) {
	for _, weak := range []string{"", "short", "alllowercase123", "ALLUPPERCASE123", "NoNumbersHere"} {
		if !errors.Is(ValidatePassword(weak), ErrWeakPassword) {
			t.Errorf("ValidatePassword(%q) should reject weak password", weak)
		}
	}

	const password = "CorrectHorse9Battery"
	hash, err := HashPassword(password)
	if err != nil {
		t.Fatalf("HashPassword: %v", err)
	}
	if hash == password {
		t.Fatal("password was persisted raw")
	}
	if err := VerifyPassword(hash, password); err != nil {
		t.Fatalf("VerifyPassword(correct): %v", err)
	}
	if !errors.Is(VerifyPassword(hash, "incorrect"), ErrInvalidCredentials) {
		t.Fatal("VerifyPassword(incorrect) did not return the generic sentinel")
	}
}

func TestOpaqueSecretsAreRandomAndHashToFixedWidth(t *testing.T) {
	first, err := GenerateOpaqueToken()
	if err != nil {
		t.Fatalf("GenerateOpaqueToken: %v", err)
	}
	second, err := GenerateOpaqueToken()
	if err != nil {
		t.Fatalf("GenerateOpaqueToken: %v", err)
	}
	if first == second {
		t.Fatal("two generated tokens matched")
	}
	if len(HashSecret(first)) != 32 {
		t.Fatalf("token hash length = %d, want 32", len(HashSecret(first)))
	}
	if bytes.Equal(HashSecret(first), []byte(first)) {
		t.Fatal("stored token hash equals raw token")
	}

	code, err := GenerateAuthorizationCode("worker")
	if err != nil {
		t.Fatalf("GenerateAuthorizationCode: %v", err)
	}
	if matched := regexp.MustCompile(`^WORKER-[A-Z2-7]{32}$`).MatchString(code); !matched {
		t.Fatalf("code %q does not have the expected safe format", code)
	}
}

func TestNewUUIDProducesVersion4Variant(t *testing.T) {
	id, err := NewUUID()
	if err != nil {
		t.Fatalf("NewUUID: %v", err)
	}
	if matched := regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`).MatchString(id); !matched {
		t.Fatalf("NewUUID() = %q, want RFC 4122 version 4", id)
	}
}
