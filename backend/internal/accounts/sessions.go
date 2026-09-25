package accounts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"time"
)

func (s *PostgresStore) CreateSession(
	ctx context.Context,
	userID string,
	session NewSession,
	now time.Time,
) error {
	if len(session.TokenHash) != 32 || session.ID == "" || !session.ExpiresAt.After(now) {
		return ErrValidation
	}
	result, err := s.db.ExecContext(ctx, `
		INSERT INTO sessions (id, user_id, token_hash, expires_at, last_seen_at, created_at)
		SELECT $1, u.id, $3, $4, $5, $5
		FROM users u
		WHERE u.id = $2 AND u.is_active = true`,
		session.ID, userID, session.TokenHash, session.ExpiresAt, now,
	)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	if err != nil {
		return fmt.Errorf("accounts: create session: %w", err)
	}
	if affected, _ := result.RowsAffected(); affected != 1 {
		return ErrNotFound
	}
	return nil
}

func (s *PostgresStore) FindSession(
	ctx context.Context,
	tokenHash []byte,
	now time.Time,
) (SessionPrincipal, error) {
	query := `
		SELECT s.id, s.user_id, s.expires_at, s.created_at,
		       u.id, u.name, u.company_id, c.name, u.phone,
		       COALESCE(personal.normalized_email, ''),
		       COALESCE(company_email.normalized_email, ''),
		       u.role, u.is_active, u.manager_admin_id,
		       COALESCE(manager.name, ''),
		       COALESCE(manager_email.normalized_email, '')
		FROM sessions s
		JOIN users u ON u.id = s.user_id
		JOIN companies c ON c.id = u.company_id
		LEFT JOIN user_login_emails personal
		       ON personal.user_id = u.id AND personal.email_kind = 'personal'
		LEFT JOIN user_login_emails company_email
		       ON company_email.user_id = u.id AND company_email.email_kind = 'company'
		LEFT JOIN users manager ON manager.id = u.manager_admin_id
		LEFT JOIN user_login_emails manager_email
		       ON manager_email.user_id = manager.id AND manager_email.email_kind = 'company'
		WHERE s.token_hash = $1
		  AND s.revoked_at IS NULL
		  AND s.expires_at > $2
		  AND u.is_active = true`

	row := s.db.QueryRowContext(ctx, query, tokenHash, now)
	var principal SessionPrincipal
	var role string
	var managerID sql.NullString
	var managerName, managerEmail string
	err := row.Scan(
		&principal.Session.ID,
		&principal.Session.UserID,
		&principal.Session.ExpiresAt,
		&principal.Session.CreatedAt,
		&principal.Account.ID,
		&principal.Account.FullName,
		&principal.Account.CompanyID,
		&principal.Account.CompanyName,
		&principal.Account.Phone,
		&principal.Account.PersonalEmail,
		&principal.Account.CompanyEmail,
		&role,
		&principal.Account.IsActive,
		&managerID,
		&managerName,
		&managerEmail,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return SessionPrincipal{}, ErrInvalidSession
	}
	if err != nil {
		return SessionPrincipal{}, fmt.Errorf("accounts: find session: %w", err)
	}
	principal.Account.Role = Role(role)
	attachManager(&principal.Account, managerID, managerName, managerEmail)
	return principal, nil
}

func (s *PostgresStore) RevokeSession(ctx context.Context, tokenHash []byte, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE sessions
		SET revoked_at = COALESCE(revoked_at, $2)
		WHERE token_hash = $1`, tokenHash, now)
	if err != nil {
		return fmt.Errorf("accounts: revoke session: %w", err)
	}
	return nil
}

func (s *PostgresStore) RevokeUserSessions(ctx context.Context, userID string, now time.Time) error {
	_, err := s.db.ExecContext(ctx, `
		UPDATE sessions
		SET revoked_at = COALESCE(revoked_at, $2)
		WHERE user_id = $1 AND revoked_at IS NULL`, userID, now)
	if err != nil {
		return fmt.Errorf("accounts: revoke user sessions: %w", err)
	}
	return nil
}
