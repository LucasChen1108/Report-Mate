package accounts

import (
	"context"
	"fmt"
	"strings"
)

func (s *PostgresStore) UpdateProfile(
	ctx context.Context,
	userID string,
	input ProfileUpdate,
) (Account, error) {
	fullName := normalizeOrdinaryText(input.FullName)
	phone := NormalizePhone(input.Phone)
	personalEmail := NormalizeEmail(input.PersonalEmail)
	if fullName == "" || !emailPattern.MatchString(personalEmail) || !validPhone(phone) {
		return Account{}, ErrValidation
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, fmt.Errorf("accounts: update profile: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(ctx, `
		UPDATE users
		SET name = $1, phone = $2, updated_at = now()
		WHERE id = $3`, fullName, phone, userID)
	if err != nil {
		return Account{}, fmt.Errorf("accounts: update profile: update user: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		return Account{}, ErrNotFound
	}

	result, err = tx.ExecContext(ctx, `
		UPDATE user_login_emails
		SET normalized_email = $1
		WHERE user_id = $2 AND email_kind = 'personal'`, personalEmail, userID)
	if isUniqueViolation(err) {
		return Account{}, ErrEmailConflict
	}
	if err != nil {
		return Account{}, fmt.Errorf("accounts: update profile: update email: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected == 0 {
		_, err = tx.ExecContext(ctx, `
			INSERT INTO user_login_emails (normalized_email, user_id, email_kind)
			VALUES ($1, $2, 'personal')`, personalEmail, userID)
		if isUniqueViolation(err) {
			return Account{}, ErrEmailConflict
		}
		if err != nil {
			return Account{}, fmt.Errorf("accounts: update profile: insert email: %w", err)
		}
	}

	account, err := scanAccount(tx.QueryRowContext(ctx, accountSelect+` WHERE u.id = $1`, userID))
	if err != nil {
		return Account{}, err
	}
	if err := tx.Commit(); err != nil {
		return Account{}, fmt.Errorf("accounts: update profile: commit: %w", err)
	}
	return account, nil
}

func normalizeOrdinaryText(value string) string {
	return strings.TrimSpace(value)
}

func validPhone(phone string) bool {
	digits := 0
	for _, char := range phone {
		if char >= '0' && char <= '9' {
			digits++
		}
	}
	return phonePattern.MatchString(phone) && digits >= 7 && digits <= 15
}
