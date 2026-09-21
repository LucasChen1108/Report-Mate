package accounts

import (
	"errors"
	"testing"
)

func TestNormalizeIdentityValues(t *testing.T) {
	if got := NormalizeEmail("  Person@Example.COM "); got != "person@example.com" {
		t.Fatalf("NormalizeEmail() = %q", got)
	}
	if got := NormalizeCompanyName("  Acme   Field  Services "); got != "acme field services" {
		t.Fatalf("NormalizeCompanyName() = %q", got)
	}
}

func TestValidateNewAccount(t *testing.T) {
	valid := NewAccount{
		ID:            "user-id",
		FullName:      "Worker One",
		Company:       "Acme",
		Phone:         "+65 6123 4567",
		PersonalEmail: "worker@example.com",
		CompanyEmail:  "worker@acme.example",
		PasswordHash:  "bcrypt-hash",
	}
	if err := ValidateNewAccount(valid); err != nil {
		t.Fatalf("ValidateNewAccount(valid): %v", err)
	}

	invalid := valid
	invalid.CompanyEmail = "WORKER@example.com"
	if !errors.Is(ValidateNewAccount(invalid), ErrValidation) {
		t.Fatal("same normalized personal/company email should be rejected")
	}

	invalid = valid
	invalid.Phone = "123"
	if !errors.Is(ValidateNewAccount(invalid), ErrValidation) {
		t.Fatal("short phone should be rejected")
	}
}
