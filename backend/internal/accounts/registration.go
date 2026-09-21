package accounts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

func (s *PostgresStore) RegisterAdmin(
	ctx context.Context,
	input NewAccount,
	codeHash []byte,
	session NewSession,
	now time.Time,
) (Account, error) {
	if err := ValidateNewAccount(input); err != nil || !validSecretRecord(codeHash, session, now) {
		return Account{}, ErrValidation
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, fmt.Errorf("accounts: register admin: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var companyID, companyName, normalizedCompany string
	var expiresAt time.Time
	var revokedAt sql.NullTime
	var usedCount, maxUses int
	err = tx.QueryRowContext(ctx, `
		SELECT c.id, c.name, c.normalized_name,
		       code.expires_at, code.revoked_at, code.used_count, code.max_uses
		FROM company_admin_codes code
		JOIN companies c ON c.id = code.company_id
		WHERE code.code_hash = $1
		FOR UPDATE OF code`, codeHash).Scan(
		&companyID,
		&companyName,
		&normalizedCompany,
		&expiresAt,
		&revokedAt,
		&usedCount,
		&maxUses,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrInvalidCode
	}
	if err != nil {
		return Account{}, fmt.Errorf("accounts: register admin: lock code: %w", err)
	}
	if err := authorizationCodeState(expiresAt, revokedAt.Valid, usedCount >= maxUses, now); err != nil {
		return Account{}, err
	}
	if NormalizeCompanyName(input.Company) != normalizedCompany {
		return Account{}, ErrCompanyMismatch
	}

	if err := insertAccount(ctx, tx, input, companyID, RoleAdmin, nil); err != nil {
		return Account{}, err
	}
	if _, err := tx.ExecContext(ctx, `
		UPDATE company_admin_codes
		SET used_count = used_count + 1, updated_at = $2
		WHERE code_hash = $1`, codeHash, now); err != nil {
		return Account{}, fmt.Errorf("accounts: register admin: consume code: %w", err)
	}
	if err := insertSession(ctx, tx, input.ID, session, now); err != nil {
		return Account{}, err
	}

	account, err := scanAccount(tx.QueryRowContext(ctx, accountSelect+` WHERE u.id = $1`, input.ID))
	if err != nil {
		return Account{}, err
	}
	account.CompanyName = companyName
	if err := tx.Commit(); err != nil {
		return Account{}, fmt.Errorf("accounts: register admin: commit: %w", err)
	}
	return account, nil
}

func (s *PostgresStore) RegisterWorker(
	ctx context.Context,
	input NewAccount,
	codeHash []byte,
	session NewSession,
	now time.Time,
) (Account, error) {
	if err := ValidateNewAccount(input); err != nil || !validSecretRecord(codeHash, session, now) {
		return Account{}, ErrValidation
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, fmt.Errorf("accounts: register worker: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	var companyID, companyName, normalizedCompany, managerID string
	var expiresAt time.Time
	var revokedAt, redeemedAt sql.NullTime
	err = tx.QueryRowContext(ctx, `
		SELECT c.id, c.name, c.normalized_name, code.manager_admin_id,
		       code.expires_at, code.revoked_at, code.redeemed_at
		FROM worker_join_codes code
		JOIN companies c ON c.id = code.company_id
		JOIN users manager ON manager.id = code.manager_admin_id
		WHERE code.code_hash = $1
		  AND manager.role = 'dispatcher_admin'
		  AND manager.is_active = true
		FOR UPDATE OF code`, codeHash).Scan(
		&companyID,
		&companyName,
		&normalizedCompany,
		&managerID,
		&expiresAt,
		&revokedAt,
		&redeemedAt,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrInvalidCode
	}
	if err != nil {
		return Account{}, fmt.Errorf("accounts: register worker: lock code: %w", err)
	}
	if err := authorizationCodeState(expiresAt, revokedAt.Valid, redeemedAt.Valid, now); err != nil {
		return Account{}, err
	}
	if NormalizeCompanyName(input.Company) != normalizedCompany {
		return Account{}, ErrCompanyMismatch
	}

	if err := insertAccount(ctx, tx, input, companyID, RoleWorker, &managerID); err != nil {
		return Account{}, err
	}
	result, err := tx.ExecContext(ctx, `
		UPDATE worker_join_codes
		SET redeemed_by = $2, redeemed_at = $3, updated_at = $3
		WHERE code_hash = $1 AND redeemed_at IS NULL`, codeHash, input.ID, now)
	if err != nil {
		return Account{}, fmt.Errorf("accounts: register worker: consume code: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return Account{}, ErrUsedCode
	}
	if err := insertSession(ctx, tx, input.ID, session, now); err != nil {
		return Account{}, err
	}

	account, err := scanAccount(tx.QueryRowContext(ctx, accountSelect+` WHERE u.id = $1`, input.ID))
	if err != nil {
		return Account{}, err
	}
	account.CompanyName = companyName
	if err := tx.Commit(); err != nil {
		return Account{}, fmt.Errorf("accounts: register worker: commit: %w", err)
	}
	return account, nil
}

func insertAccount(
	ctx context.Context,
	tx *sql.Tx,
	input NewAccount,
	companyID string,
	role Role,
	managerID *string,
) error {
	personalEmail := NormalizeEmail(input.PersonalEmail)
	companyEmail := NormalizeEmail(input.CompanyEmail)
	_, err := tx.ExecContext(ctx, `
		INSERT INTO users
		    (id, name, email, password_hash, role, company_id, phone,
		     manager_admin_id, is_active)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)`,
		input.ID,
		normalizeOrdinaryText(input.FullName),
		companyEmail,
		input.PasswordHash,
		string(role),
		companyID,
		NormalizePhone(input.Phone),
		managerID,
	)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	if err != nil {
		return fmt.Errorf("accounts: insert user: %w", err)
	}

	_, err = tx.ExecContext(ctx, `
		INSERT INTO user_login_emails (normalized_email, user_id, email_kind)
		VALUES ($1, $3, 'personal'), ($2, $3, 'company')`,
		personalEmail, companyEmail, input.ID,
	)
	if isUniqueViolation(err) {
		return ErrEmailConflict
	}
	if err != nil {
		return fmt.Errorf("accounts: insert login identities: %w", err)
	}
	return nil
}

func validSecretRecord(codeHash []byte, session NewSession, now time.Time) bool {
	return len(codeHash) == 32 &&
		len(session.TokenHash) == 32 &&
		session.ID != "" &&
		session.ExpiresAt.After(now)
}

func authorizationCodeState(expiresAt time.Time, revoked, used bool, now time.Time) error {
	switch {
	case revoked:
		return ErrRevokedCode
	case used:
		return ErrUsedCode
	case !now.Before(expiresAt):
		return ErrExpiredCode
	default:
		return nil
	}
}

func insertSession(
	ctx context.Context,
	tx *sql.Tx,
	userID string,
	session NewSession,
	now time.Time,
) error {
	_, err := tx.ExecContext(ctx, `
		INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at)
		VALUES ($1, $2, $3, $4, $5, $5)`,
		session.ID, userID, session.TokenHash, session.ExpiresAt, now,
	)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	if err != nil {
		return fmt.Errorf("accounts: insert session: %w", err)
	}
	return nil
}
