package accounts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

func (s *PostgresStore) ListWorkers(ctx context.Context, adminID string) ([]Account, error) {
	rows, err := s.db.QueryContext(ctx, accountSelect+`
		WHERE u.manager_admin_id = $1 AND u.role = 'technician'
		ORDER BY u.name, u.id`, adminID)
	if err != nil {
		return nil, fmt.Errorf("accounts: list workers: %w", err)
	}
	defer rows.Close()

	workers := make([]Account, 0)
	for rows.Next() {
		worker, err := scanAccount(rows)
		if err != nil {
			return nil, err
		}
		workers = append(workers, worker)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("accounts: list workers: iterate: %w", err)
	}
	return workers, nil
}

func (s *PostgresStore) UpdateWorkerStatus(
	ctx context.Context,
	adminID string,
	workerID string,
	isActive bool,
	now time.Time,
) (Account, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return Account{}, fmt.Errorf("accounts: update worker status: begin: %w", err)
	}
	defer func() { _ = tx.Rollback() }()

	result, err := tx.ExecContext(ctx, `
		UPDATE users
		SET is_active = $3, updated_at = $4
		WHERE id = $2
		  AND manager_admin_id = $1
		  AND role = 'technician'`, adminID, workerID, isActive, now)
	if err != nil {
		return Account{}, fmt.Errorf("accounts: update worker status: update: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return Account{}, ErrNotFound
	}

	if !isActive {
		if _, err := tx.ExecContext(ctx, `
			UPDATE sessions
			SET revoked_at = COALESCE(revoked_at, $2)
			WHERE user_id = $1 AND revoked_at IS NULL`, workerID, now); err != nil {
			return Account{}, fmt.Errorf("accounts: update worker status: revoke sessions: %w", err)
		}
	}

	worker, err := scanAccount(tx.QueryRowContext(ctx, accountSelect+`
		WHERE u.id = $1 AND u.manager_admin_id = $2`, workerID, adminID))
	if err != nil {
		return Account{}, err
	}
	if err := tx.Commit(); err != nil {
		return Account{}, fmt.Errorf("accounts: update worker status: commit: %w", err)
	}
	return worker, nil
}

func (s *PostgresStore) CreateWorkerJoinCode(
	ctx context.Context,
	adminID string,
	input NewWorkerJoinCode,
	now time.Time,
) (JoinCode, error) {
	if input.ID == "" || len(input.CodeHash) != 32 || !input.ExpiresAt.After(now) {
		return JoinCode{}, ErrValidation
	}

	result, err := s.db.ExecContext(ctx, `
		INSERT INTO worker_join_codes
		    (id, company_id, manager_admin_id, code_hash, expires_at, created_at, updated_at)
		SELECT $2, admin.company_id, admin.id, $3, $4, $5, $5
		FROM users admin
		WHERE admin.id = $1
		  AND admin.role = 'dispatcher_admin'
		  AND admin.is_active = true`,
		adminID, input.ID, input.CodeHash, input.ExpiresAt, now,
	)
	if isUniqueViolation(err) {
		return JoinCode{}, ErrConflict
	}
	if err != nil {
		return JoinCode{}, fmt.Errorf("accounts: create worker join code: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return JoinCode{}, ErrNotFound
	}
	return s.findOwnedJoinCode(ctx, adminID, input.ID, now)
}

func (s *PostgresStore) ListWorkerJoinCodes(
	ctx context.Context,
	adminID string,
	now time.Time,
) ([]JoinCode, error) {
	rows, err := s.db.QueryContext(ctx, `
		SELECT code.id, code.company_id, company.name, code.manager_admin_id,
		       code.created_at, code.expires_at, code.revoked_at, code.redeemed_at
		FROM worker_join_codes code
		JOIN companies company ON company.id = code.company_id
		WHERE code.manager_admin_id = $1
		ORDER BY code.created_at DESC, code.id`, adminID)
	if err != nil {
		return nil, fmt.Errorf("accounts: list worker join codes: %w", err)
	}
	defer rows.Close()

	codes := make([]JoinCode, 0)
	for rows.Next() {
		code, err := scanJoinCode(rows, now)
		if err != nil {
			return nil, err
		}
		codes = append(codes, code)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("accounts: list worker join codes: iterate: %w", err)
	}
	return codes, nil
}

func (s *PostgresStore) RevokeWorkerJoinCode(
	ctx context.Context,
	adminID string,
	codeID string,
	now time.Time,
) (JoinCode, error) {
	result, err := s.db.ExecContext(ctx, `
		UPDATE worker_join_codes
		SET revoked_at = COALESCE(revoked_at, $3), updated_at = $3
		WHERE id = $2
		  AND manager_admin_id = $1
		  AND redeemed_at IS NULL`, adminID, codeID, now)
	if err != nil {
		return JoinCode{}, fmt.Errorf("accounts: revoke worker join code: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return JoinCode{}, ErrNotFound
	}
	return s.findOwnedJoinCode(ctx, adminID, codeID, now)
}

func (s *PostgresStore) findOwnedJoinCode(
	ctx context.Context,
	adminID string,
	codeID string,
	now time.Time,
) (JoinCode, error) {
	row := s.db.QueryRowContext(ctx, `
		SELECT code.id, code.company_id, company.name, code.manager_admin_id,
		       code.created_at, code.expires_at, code.revoked_at, code.redeemed_at
		FROM worker_join_codes code
		JOIN companies company ON company.id = code.company_id
		WHERE code.id = $2 AND code.manager_admin_id = $1`, adminID, codeID)
	code, err := scanJoinCode(row, now)
	if errors.Is(err, sql.ErrNoRows) {
		return JoinCode{}, ErrNotFound
	}
	return code, err
}

func scanJoinCode(row scanner, now time.Time) (JoinCode, error) {
	var code JoinCode
	var revokedAt, redeemedAt sql.NullTime
	if err := row.Scan(
		&code.ID,
		&code.CompanyID,
		&code.CompanyName,
		&code.CreatedByAdminID,
		&code.CreatedAt,
		&code.ExpiresAt,
		&revokedAt,
		&redeemedAt,
	); err != nil {
		return JoinCode{}, err
	}
	switch {
	case revokedAt.Valid:
		code.Status = JoinCodeRevoked
	case redeemedAt.Valid:
		code.Status = JoinCodeUsed
	case !now.Before(code.ExpiresAt):
		code.Status = JoinCodeExpired
	default:
		code.Status = JoinCodeActive
	}
	return code, nil
}
