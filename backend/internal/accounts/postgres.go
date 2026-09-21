package accounts

import (
	"context"
	"database/sql"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5/pgconn"
)

type PostgresStore struct {
	db *sql.DB
}

var _ Store = (*PostgresStore)(nil)

func NewPostgresStore(db *sql.DB) *PostgresStore {
	return &PostgresStore{db: db}
}

const accountSelect = `
	SELECT u.id,
	       u.name,
	       u.company_id,
	       c.name,
	       u.phone,
	       COALESCE(personal.normalized_email, ''),
	       COALESCE(company_email.normalized_email, ''),
	       u.role,
	       u.is_active,
	       u.manager_admin_id,
	       COALESCE(manager.name, ''),
	       COALESCE(manager_email.normalized_email, '')
	FROM users u
	JOIN companies c ON c.id = u.company_id
	LEFT JOIN user_login_emails personal
	       ON personal.user_id = u.id AND personal.email_kind = 'personal'
	LEFT JOIN user_login_emails company_email
	       ON company_email.user_id = u.id AND company_email.email_kind = 'company'
	LEFT JOIN users manager ON manager.id = u.manager_admin_id
	LEFT JOIN user_login_emails manager_email
	       ON manager_email.user_id = manager.id AND manager_email.email_kind = 'company'`

func (s *PostgresStore) FindByEmail(ctx context.Context, email string) (Account, error) {
	query := accountSelect + `
	WHERE u.id = (
		SELECT user_id
		FROM user_login_emails
		WHERE normalized_email = $1
	)`
	return scanAccount(s.db.QueryRowContext(ctx, query, NormalizeEmail(email)))
}

func (s *PostgresStore) FindCredentialsByEmail(ctx context.Context, email string) (Credentials, error) {
	query := `
		SELECT u.id,
		       u.name,
		       u.company_id,
		       c.name,
		       u.phone,
		       COALESCE(personal.normalized_email, ''),
		       COALESCE(company_email.normalized_email, ''),
		       u.role,
		       u.is_active,
		       u.manager_admin_id,
		       COALESCE(manager.name, ''),
		       COALESCE(manager_email.normalized_email, ''),
		       u.password_hash
		FROM users u
		JOIN companies c ON c.id = u.company_id
		LEFT JOIN user_login_emails personal
		       ON personal.user_id = u.id AND personal.email_kind = 'personal'
		LEFT JOIN user_login_emails company_email
		       ON company_email.user_id = u.id AND company_email.email_kind = 'company'
		LEFT JOIN users manager ON manager.id = u.manager_admin_id
		LEFT JOIN user_login_emails manager_email
		       ON manager_email.user_id = manager.id AND manager_email.email_kind = 'company'
		WHERE u.id = (
			SELECT user_id
			FROM user_login_emails
			WHERE normalized_email = $1
		)`

	row := s.db.QueryRowContext(ctx, query, NormalizeEmail(email))
	var credentials Credentials
	var role string
	var managerID sql.NullString
	var managerName, managerEmail string
	err := row.Scan(
		&credentials.Account.ID,
		&credentials.Account.FullName,
		&credentials.Account.CompanyID,
		&credentials.Account.CompanyName,
		&credentials.Account.Phone,
		&credentials.Account.PersonalEmail,
		&credentials.Account.CompanyEmail,
		&role,
		&credentials.Account.IsActive,
		&managerID,
		&managerName,
		&managerEmail,
		&credentials.PasswordHash,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Credentials{}, ErrNotFound
	}
	if err != nil {
		return Credentials{}, fmt.Errorf("accounts: scan credentials: %w", err)
	}
	credentials.Account.Role = Role(role)
	attachManager(&credentials.Account, managerID, managerName, managerEmail)
	return credentials, nil
}

func (s *PostgresStore) FindByID(ctx context.Context, id string) (Account, error) {
	return scanAccount(s.db.QueryRowContext(ctx, accountSelect+` WHERE u.id = $1`, id))
}

type scanner interface {
	Scan(...any) error
}

func scanAccount(row scanner) (Account, error) {
	var account Account
	var role string
	var managerID sql.NullString
	var managerName string
	var managerEmail string
	err := row.Scan(
		&account.ID,
		&account.FullName,
		&account.CompanyID,
		&account.CompanyName,
		&account.Phone,
		&account.PersonalEmail,
		&account.CompanyEmail,
		&role,
		&account.IsActive,
		&managerID,
		&managerName,
		&managerEmail,
	)
	if errors.Is(err, sql.ErrNoRows) {
		return Account{}, ErrNotFound
	}
	if err != nil {
		return Account{}, fmt.Errorf("accounts: scan account: %w", err)
	}

	account.Role = Role(role)
	attachManager(&account, managerID, managerName, managerEmail)
	return account, nil
}

func attachManager(account *Account, managerID sql.NullString, managerName, managerEmail string) {
	if !managerID.Valid {
		return
	}
	account.ManagerAdminID = &managerID.String
	account.LinkedAdmin = &LinkedAdmin{
		ID:           managerID.String,
		FullName:     managerName,
		CompanyEmail: managerEmail,
	}
}

func (s *PostgresStore) CreateCompany(ctx context.Context, company Company) error {
	normalizedName := NormalizeCompanyName(company.NormalizedName)
	if normalizedName == "" {
		normalizedName = NormalizeCompanyName(company.Name)
	}
	if company.ID == "" || normalizedName == "" || normalizeOrdinaryText(company.Name) == "" {
		return ErrValidation
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO companies (id, name, normalized_name)
		VALUES ($1, $2, $3)`,
		company.ID,
		normalizeOrdinaryText(company.Name),
		normalizedName,
	)
	if isUniqueViolation(err) {
		return ErrConflict
	}
	if err != nil {
		return fmt.Errorf("accounts: create company: %w", err)
	}
	return nil
}

func (s *PostgresStore) CreateCompanyAdminCode(ctx context.Context, code NewCompanyAdminCode) error {
	if code.ID == "" || code.CompanyID == "" || len(code.CodeHash) != 32 || code.MaxUses < 1 {
		return ErrValidation
	}
	_, err := s.db.ExecContext(ctx, `
		INSERT INTO company_admin_codes
		    (id, company_id, code_hash, max_uses, expires_at)
		VALUES ($1, $2, $3, $4, $5)`,
		code.ID, code.CompanyID, code.CodeHash, code.MaxUses, code.ExpiresAt,
	)
	if isUniqueViolation(err) {
		return ErrInvalidCode
	}
	if err != nil {
		return fmt.Errorf("accounts: create company admin code: %w", err)
	}
	return nil
}

func isUniqueViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
