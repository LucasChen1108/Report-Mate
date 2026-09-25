package accounts

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestAccountCannotSerializePasswordHash(t *testing.T) {
	payload, err := json.Marshal(Account{
		ID: "user-id", FullName: "Example User", CompanyEmail: "user@example.test",
	})
	if err != nil {
		t.Fatalf("marshal Account: %v", err)
	}
	if strings.Contains(strings.ToLower(string(payload)), "password") {
		t.Fatalf("Account JSON contains password material: %s", payload)
	}
}
