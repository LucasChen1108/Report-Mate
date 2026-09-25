package accounts

import (
	"errors"
	"regexp"
	"strings"
)

var (
	ErrValidation = errors.New("accounts: validation failed")
	emailPattern  = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	phonePattern  = regexp.MustCompile(`^\+?[0-9 ()-]+$`)
)

func NormalizeEmail(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func NormalizeCompanyName(value string) string {
	return strings.ToLower(strings.Join(strings.Fields(value), " "))
}

func NormalizePhone(value string) string {
	return strings.TrimSpace(value)
}

func ValidateNewAccount(input NewAccount) error {
	if strings.TrimSpace(input.ID) == "" ||
		strings.TrimSpace(input.FullName) == "" ||
		NormalizeCompanyName(input.Company) == "" ||
		strings.TrimSpace(input.PasswordHash) == "" {
		return ErrValidation
	}

	personal := NormalizeEmail(input.PersonalEmail)
	company := NormalizeEmail(input.CompanyEmail)
	if !emailPattern.MatchString(personal) ||
		!emailPattern.MatchString(company) ||
		personal == company {
		return ErrValidation
	}

	phone := NormalizePhone(input.Phone)
	digits := 0
	for _, char := range phone {
		if char >= '0' && char <= '9' {
			digits++
		}
	}
	if !phonePattern.MatchString(phone) || digits < 7 || digits > 15 {
		return ErrValidation
	}
	return nil
}
