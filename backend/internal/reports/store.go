package reports

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"

	// pgx stdlib driver registers itself as the "pgx" database/sql driver, the
	// same way templates/store.go imports it: a *sql.DB opened with it works
	// out of the box, while the pool itself is wired in cmd/server.
	_ "github.com/jackc/pgx/v5/stdlib"
)

// ErrNotFound is returned when no service_reports row matches the requested id.
// Callers (the HTTP handlers) map this to a 404 response, exactly as
// templates.ErrNotFound is mapped.
var ErrNotFound = errors.New("report not found")

// ErrNoExport is returned when a report exists but has never been exported, so
// there is no rendered document to serve. It is distinct from ErrNotFound so
// GET /api/reports/{id}/export can say which of the two is missing.
var ErrNoExport = errors.New("report has no export")

// Paging bounds for List. The cap exists because a report carries its full
// content and schema snapshot, and content carries inline base64 photos — an
// uncapped page is measured in hundreds of megabytes, not rows.
const (
	defaultListLimit = 25
	maxListLimit     = 100
)

// ReportRecord is a persisted service report. Its JSON shape mirrors the
// frontend api/reportTypes.ts ReportRecord type exactly — that file is frozen
// and authoritative, which is why the JSON tags are camelCase while the columns
// underneath are snake_case.
//
// SchemaSnapshot and TemplateRevision pin the report to the template AS IT WAS
// AT FILL TIME. They are written once, by Create, and no other method touches
// them: a later edit to the template must never change how an existing report
// renders or exports.
type ReportRecord struct {
	ID               string                   `json:"id"`
	TemplateID       string                   `json:"templateId"`
	TemplateRevision int                      `json:"templateRevision"`
	SchemaSnapshot   templates.TemplateSchema `json:"schemaSnapshot"`
	JobID            *string                  `json:"jobId"`
	TechnicianID     *string                  `json:"technicianId"`
	Title            string                   `json:"title"`
	CustomerName     string                   `json:"customerName"`
	Content          ReportContent            `json:"content"`
	Status           string                   `json:"status"`
	FilledBy         string                   `json:"filledBy"`
	SubmittedAt      *time.Time               `json:"submittedAt"`
	ExportedAt       *time.Time               `json:"exportedAt"`
	CreatedAt        time.Time                `json:"createdAt"`
	UpdatedAt        time.Time                `json:"updatedAt"`
}

// CreateParams is the input to Create. Template is the template record the
// report is being filled against; its schema and revision are snapshotted onto
// the new row.
type CreateParams struct {
	Template     templates.TemplateRecord
	TechnicianID string
	JobID        *string
	Title        string
	CustomerName string
	Content      ReportContent
}

// UpdateParams is the input to Update. An empty Title leaves the stored title
// untouched rather than blanking it — see Update.
type UpdateParams struct {
	Title        string
	CustomerName string
	Content      ReportContent
}

// ListFilter narrows a List query. Every field is optional; a zero value means
// "do not filter on this". Limit and Offset are normalized by List itself, so a
// caller may pass them through unvalidated.
type ListFilter struct {
	TemplateID   string
	Status       string
	TechnicianID string
	From         *time.Time
	To           *time.Time
	Query        string
	Limit        int
	Offset       int
}

// ListResult is the paginated response body for GET /api/reports: a page of
// reports plus the total matching the filter, so the client can page without a
// second count call.
type ListResult struct {
	Reports []ReportRecord `json:"reports"`
	Total   int            `json:"total"`
	Limit   int            `json:"limit"`
	Offset  int            `json:"offset"`
}

// ExportRef identifies a rendered export artifact: the attachments row's
// storage key and content type, used to serve the document back.
type ExportRef struct {
	StorageKey  string
	ContentType string
}

// reportColumns is the column list every report read selects, in the order
// scanReport expects them.
const reportColumns = `id, template_id, template_revision, schema_snapshot, job_id, technician_id,
		title, customer_name, content, filled_by, status, submitted_at, exported_at, created_at, updated_at`

// querier is the subset of *sql.DB and *sql.Tx this store uses. Taking it
// rather than a concrete type is what lets the same read and write helpers run
// both standalone and inside the save-and-export transaction (service.go),
// instead of existing in two nearly-identical copies.
type querier interface {
	ExecContext(ctx context.Context, query string, args ...any) (sql.Result, error)
	QueryContext(ctx context.Context, query string, args ...any) (*sql.Rows, error)
	QueryRowContext(ctx context.Context, query string, args ...any) *sql.Row
}

// scanner is the shared Scan method of *sql.Row and *sql.Rows, so one
// scanReport serves both the single-row and the list paths.
type scanner interface {
	Scan(dest ...any) error
}

// Store owns service_reports, parts_used, and the attachments rows that record
// an export. It also holds a templates store because creating a report requires
// reading the template it snapshots — that read goes through the templates
// package's own store rather than a hand-written query here, so there is one
// definition of how a template is loaded.
type Store struct {
	db        *sql.DB
	templates templates.Store
}

// NewStore returns a Store backed by db.
func NewStore(db *sql.DB) *Store {
	return &Store{db: db, templates: templates.NewPostgresStore(db)}
}

// Template loads the template a report is to be filled against. It returns
// templates.ErrNotFound for an unknown id, which the handler maps to a 404.
func (s *Store) Template(ctx context.Context, templateID string) (templates.TemplateRecord, error) {
	record, err := s.templates.Get(ctx, templateID)
	if err != nil {
		return templates.TemplateRecord{}, fmt.Errorf("reports: load template: %w", err)
	}
	return record, nil
}

// Create inserts a new report, SNAPSHOTTING the template's schema and revision
// onto the row. That snapshot is the whole point of the design
// (0006_service_reports.sql): a report renders from the schema it was filled
// against, so editing the template afterwards cannot retroactively change a
// report that someone already signed off on. No other method writes those two
// columns.
//
// The insert and the parts rows go in one transaction: a report whose parts
// were half-written is worse than no report at all.
func (s *Store) Create(ctx context.Context, params CreateParams) (ReportRecord, error) {
	content := params.Content.normalized()

	rawSchema, err := json.Marshal(params.Template.Schema)
	if err != nil {
		return ReportRecord{}, fmt.Errorf("reports: create marshal schema snapshot: %w", err)
	}
	rawContent, err := json.Marshal(content)
	if err != nil {
		return ReportRecord{}, fmt.Errorf("reports: create marshal content: %w", err)
	}

	title := strings.TrimSpace(params.Title)
	if title == "" {
		title = defaultTitle(params.Template.Name, params.CustomerName, time.Now())
	}

	const query = `
		INSERT INTO service_reports
			(template_id, template_revision, schema_snapshot, job_id, technician_id,
			 title, customer_name, content, filled_by)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
		RETURNING ` + reportColumns

	var record ReportRecord
	err = s.withTx(ctx, func(tx *sql.Tx) error {
		row := tx.QueryRowContext(ctx, query,
			params.Template.ID,
			params.Template.Revision,
			rawSchema,
			nullableString(params.JobID),
			nullableString(&params.TechnicianID),
			title,
			params.CustomerName,
			rawContent,
			content.FilledBy,
		)

		created, err := scanReport(row)
		if err != nil {
			if errors.Is(err, ErrNotFound) {
				// RETURNING on a successful INSERT always yields a row.
				return fmt.Errorf("reports: create returned no row")
			}
			return err
		}

		if err := replaceParts(ctx, tx, created.ID, content.Parts); err != nil {
			return err
		}
		created.Content.Parts = content.Parts
		record = created
		return nil
	})
	if err != nil {
		return ReportRecord{}, err
	}
	return record, nil
}

// Get returns the report for id with its parts_used rows merged back into
// Content.Parts, in the order they were entered, so the caller sees one
// ReportContent rather than a report and a separate parts table.
//
// parts_used is the source of truth for the Parts Used table: content.parts is
// also persisted inside the jsonb (so the stored content is a complete,
// self-contained record of what was written), but every read overlays the rows,
// which carry the authoritative order.
func (s *Store) Get(ctx context.Context, id string) (ReportRecord, error) {
	return getReport(ctx, s.db, id)
}

// Update replaces the content, customer name and title of an existing report
// and refreshes updated_at. It NEVER touches schema_snapshot or
// template_revision — a report stays pinned to the template it was filled
// against for its whole life.
//
// An empty title leaves the stored one in place. Create always derives a
// non-empty title, so blank here means "the client did not set one", never
// "clear it": blanking it would leave an empty row in the dashboard list.
//
// Status is not touched either. A draft save is a save, not a submission; the
// only path to 'exported' is SaveAndExport.
func (s *Store) Update(ctx context.Context, id string, params UpdateParams) (ReportRecord, error) {
	var record ReportRecord
	err := s.withTx(ctx, func(tx *sql.Tx) error {
		updated, err := updateReport(ctx, tx, id, params)
		if err != nil {
			return err
		}
		record = updated
		return nil
	})
	if err != nil {
		return ReportRecord{}, err
	}
	return record, nil
}

// List returns a filtered, ordered page of reports plus the total number
// matching the same filter. Results are newest first.
//
// The count and the page are two statements rather than one windowed query so
// the total stays correct when the offset runs past the end of the result set —
// a windowed count returns nothing at all for an empty page and would report
// zero matches for a filter that actually has hundreds.
func (s *Store) List(ctx context.Context, filter ListFilter) (ListResult, error) {
	limit := filter.Limit
	if limit <= 0 {
		limit = defaultListLimit
	}
	if limit > maxListLimit {
		limit = maxListLimit
	}
	offset := filter.Offset
	if offset < 0 {
		offset = 0
	}

	where, args := buildListWhere(filter)

	var total int
	countQuery := `SELECT count(*) FROM service_reports` + where
	if err := s.db.QueryRowContext(ctx, countQuery, args...).Scan(&total); err != nil {
		return ListResult{}, fmt.Errorf("reports: list count: %w", err)
	}

	pageQuery := `SELECT ` + reportColumns + ` FROM service_reports` + where +
		fmt.Sprintf(` ORDER BY created_at DESC, id DESC LIMIT $%d OFFSET $%d`, len(args)+1, len(args)+2)
	pageArgs := append(append([]any{}, args...), limit, offset)

	rows, err := s.db.QueryContext(ctx, pageQuery, pageArgs...)
	if err != nil {
		return ListResult{}, fmt.Errorf("reports: list: %w", err)
	}
	defer rows.Close()

	reports := make([]ReportRecord, 0)
	for rows.Next() {
		record, err := scanReport(rows)
		if err != nil {
			return ListResult{}, err
		}
		reports = append(reports, record)
	}
	if err := rows.Err(); err != nil {
		return ListResult{}, fmt.Errorf("reports: list rows: %w", err)
	}

	// The listed reports carry the parts stored inside their content jsonb
	// rather than a parts_used join per row: the page would otherwise cost one
	// extra query per report, and every write path keeps the two in step.
	return ListResult{Reports: reports, Total: total, Limit: limit, Offset: offset}, nil
}

// LatestExport returns the most recent export_html attachment for a report, or
// ErrNoExport when the report has never been exported. ErrNotFound is returned
// when the report itself does not exist, so the two cases stay distinguishable.
func (s *Store) LatestExport(ctx context.Context, id string) (ExportRef, error) {
	const existsQuery = `SELECT 1 FROM service_reports WHERE id = $1`
	var exists int
	switch err := s.db.QueryRowContext(ctx, existsQuery, id).Scan(&exists); {
	case errors.Is(err, sql.ErrNoRows):
		return ExportRef{}, ErrNotFound
	case err != nil:
		return ExportRef{}, fmt.Errorf("reports: latest export exists: %w", err)
	}

	const query = `
		SELECT storage_key, content_type
		FROM attachments
		WHERE report_id = $1 AND kind = 'export_html'
		ORDER BY created_at DESC, id DESC
		LIMIT 1`

	var ref ExportRef
	err := s.db.QueryRowContext(ctx, query, id).Scan(&ref.StorageKey, &ref.ContentType)
	if errors.Is(err, sql.ErrNoRows) {
		return ExportRef{}, ErrNoExport
	}
	if err != nil {
		return ExportRef{}, fmt.Errorf("reports: latest export: %w", err)
	}
	return ref, nil
}

// withTx runs fn inside a transaction, rolling back on any error (or panic) and
// committing only when fn returns nil.
func (s *Store) withTx(ctx context.Context, fn func(*sql.Tx) error) error {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("reports: begin transaction: %w", err)
	}
	defer func() {
		// Rollback after a successful Commit is a no-op, so this is safe on
		// every path and guarantees no transaction is left open on a panic.
		_ = tx.Rollback()
	}()

	if err := fn(tx); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return fmt.Errorf("reports: commit transaction: %w", err)
	}
	return nil
}

// getReport reads one report and merges its parts_used rows into the content.
// It takes a querier so the save-and-export transaction can read the row it is
// about to write without leaving the transaction.
func getReport(ctx context.Context, q querier, id string) (ReportRecord, error) {
	const query = `SELECT ` + reportColumns + ` FROM service_reports WHERE id = $1`

	record, err := scanReport(q.QueryRowContext(ctx, query, id))
	if err != nil {
		return ReportRecord{}, err
	}

	parts, err := selectParts(ctx, q, id)
	if err != nil {
		return ReportRecord{}, err
	}
	record.Content.Parts = parts
	return record, nil
}

// updateReport performs the content/title/customer write shared by Update and
// the save half of SaveAndExport, including the parts replacement. It never
// writes schema_snapshot, template_revision, or status.
func updateReport(ctx context.Context, q querier, id string, params UpdateParams) (ReportRecord, error) {
	content := params.Content.normalized()

	rawContent, err := json.Marshal(content)
	if err != nil {
		return ReportRecord{}, fmt.Errorf("reports: update marshal content: %w", err)
	}

	const query = `
		UPDATE service_reports
		SET title         = CASE WHEN $2 = '' THEN title ELSE $2 END,
		    customer_name = $3,
		    content       = $4,
		    filled_by     = $5,
		    updated_at    = now()
		WHERE id = $1
		RETURNING ` + reportColumns

	row := q.QueryRowContext(ctx, query, id,
		strings.TrimSpace(params.Title),
		params.CustomerName,
		rawContent,
		content.FilledBy,
	)

	record, err := scanReport(row)
	if err != nil {
		return ReportRecord{}, err
	}

	if err := replaceParts(ctx, q, id, content.Parts); err != nil {
		return ReportRecord{}, err
	}
	record.Content.Parts = content.Parts
	return record, nil
}

// markExported flips a report to the exported status and stamps exported_at.
// It is only ever called from inside the save-and-export transaction, after
// validation has passed, so a report can never be marked exported without a
// complete, validated body behind it.
func markExported(ctx context.Context, q querier, id string) (ReportRecord, error) {
	const query = `
		UPDATE service_reports
		SET status      = 'exported',
		    exported_at = now(),
		    updated_at  = now()
		WHERE id = $1
		RETURNING ` + reportColumns

	return scanReport(q.QueryRowContext(ctx, query, id))
}

// insertExportAttachment records a rendered export against the report. The
// storage key is the export's path relative to the configured export directory,
// never an absolute path, so moving the export volume does not invalidate every
// row.
func insertExportAttachment(ctx context.Context, q querier, reportID, storageKey, contentType string, byteSize int) error {
	const query = `
		INSERT INTO attachments (report_id, kind, storage_key, content_type, byte_size)
		VALUES ($1, 'export_html', $2, $3, $4)`

	if _, err := q.ExecContext(ctx, query, reportID, storageKey, contentType, byteSize); err != nil {
		return fmt.Errorf("reports: insert export attachment: %w", err)
	}
	return nil
}

// selectParts reads a report's parts_used rows in entry order, formatting each
// NUMERIC quantity back into the wire string.
func selectParts(ctx context.Context, q querier, reportID string) ([]PartRow, error) {
	const query = `
		SELECT id, part, part_number, quantity
		FROM parts_used
		WHERE report_id = $1
		ORDER BY position, created_at, id`

	rows, err := q.QueryContext(ctx, query, reportID)
	if err != nil {
		return nil, fmt.Errorf("reports: select parts: %w", err)
	}
	defer rows.Close()

	parts := make([]PartRow, 0)
	for rows.Next() {
		var (
			part     PartRow
			quantity string
		)
		if err := rows.Scan(&part.ID, &part.Part, &part.PartNumber, &quantity); err != nil {
			return nil, fmt.Errorf("reports: scan part: %w", err)
		}
		part.Quantity = quantityFromNumeric(quantity)
		parts = append(parts, part)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("reports: parts rows: %w", err)
	}
	return parts, nil
}

// replaceParts rewrites a report's Parts Used table: delete every row, then
// insert the submitted ones with their position, which is what preserves the
// order the technician entered them in.
//
// Delete-then-insert rather than a diff because the rows carry no stable
// server-side identity — the client's row ids are React keys, not database
// keys — and because the whole table always arrives together inside one
// content body. The caller runs it inside a transaction, so the table is never
// observably empty.
func replaceParts(ctx context.Context, q querier, reportID string, parts []PartRow) error {
	const deleteQuery = `DELETE FROM parts_used WHERE report_id = $1`
	if _, err := q.ExecContext(ctx, deleteQuery, reportID); err != nil {
		return fmt.Errorf("reports: delete parts: %w", err)
	}

	const insertQuery = `
		INSERT INTO parts_used (report_id, position, part, part_number, quantity)
		VALUES ($1, $2, $3, $4, $5)`

	for i, part := range parts {
		quantity, err := quantityToNumeric(part.Quantity)
		if err != nil {
			// Reported as a validation error, not a wrapped driver error, so a
			// quantity that cannot be stored answers 422 naming the row rather
			// than 500 — the caller can fix a typo, not a server fault.
			return &ValidationError{
				Field:   "type",
				Element: partElement(part, i),
				Message: fmt.Sprintf("parts used quantity must be a number, got %q", part.Quantity),
			}
		}
		if _, err := q.ExecContext(ctx, insertQuery, reportID, i, part.Part, part.PartNumber, quantity); err != nil {
			return fmt.Errorf("reports: insert part: %w", err)
		}
	}
	return nil
}

// technicianName looks up the display name of the user a report is stamped to,
// for the rendered export. A report whose technician has since been deleted
// keeps rendering (technician_id is ON DELETE SET NULL), so a missing user is
// an empty name rather than an error.
func technicianName(ctx context.Context, q querier, technicianID *string) (string, error) {
	if technicianID == nil || *technicianID == "" {
		return "", nil
	}

	const query = `SELECT name FROM users WHERE id = $1`
	var name string
	err := q.QueryRowContext(ctx, query, *technicianID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("reports: technician name: %w", err)
	}
	return name, nil
}

// templateNameFor looks up the current name of the template a report was filled
// against, for the export document's header and footer.
//
// The name is read live rather than from the snapshot because
// service_reports.schema_snapshot stores the schema only — the template's name
// is not part of the Template Schema contract, so there is nowhere in an
// existing column to have pinned it. The revision in the footer is the pinned
// value and is what actually identifies what was filled against.
func templateNameFor(ctx context.Context, q querier, templateID string) (string, error) {
	const query = `SELECT name FROM report_templates WHERE id = $1`
	var name string
	err := q.QueryRowContext(ctx, query, templateID).Scan(&name)
	if errors.Is(err, sql.ErrNoRows) {
		return "", nil
	}
	if err != nil {
		return "", fmt.Errorf("reports: template name: %w", err)
	}
	return name, nil
}

// buildListWhere turns a ListFilter into a WHERE clause and its arguments. It
// returns an empty string when nothing is filtered, so the caller can
// concatenate unconditionally.
//
// Every value is a bound parameter; nothing user-supplied is ever concatenated
// into the SQL.
func buildListWhere(filter ListFilter) (string, []any) {
	clauses := make([]string, 0)
	args := make([]any, 0)

	add := func(clause string, value any) {
		args = append(args, value)
		clauses = append(clauses, fmt.Sprintf(clause, len(args)))
	}

	if filter.TemplateID != "" {
		add("template_id = $%d", filter.TemplateID)
	}
	if filter.Status != "" {
		add("status = $%d", filter.Status)
	}
	if filter.TechnicianID != "" {
		add("technician_id = $%d", filter.TechnicianID)
	}
	if filter.From != nil {
		add("created_at >= $%d", *filter.From)
	}
	if filter.To != nil {
		add("created_at < $%d", *filter.To)
	}
	if trimmed := strings.TrimSpace(filter.Query); trimmed != "" {
		// Free-text search over the two human-facing columns. The pattern is a
		// bound parameter and its LIKE metacharacters are escaped, so a
		// customer named "100% Cooling" searches for itself rather than
		// matching everything.
		pattern := "%" + escapeLikePattern(trimmed) + "%"
		args = append(args, pattern)
		clauses = append(clauses, fmt.Sprintf(
			`(title ILIKE $%d ESCAPE '\' OR customer_name ILIKE $%d ESCAPE '\')`, len(args), len(args)))
	}

	if len(clauses) == 0 {
		return "", args
	}
	return " WHERE " + strings.Join(clauses, " AND "), args
}

// escapeLikePattern escapes the LIKE metacharacters in a user-supplied search
// term so they match literally.
func escapeLikePattern(value string) string {
	replacer := strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`)
	return replacer.Replace(value)
}

// scanReport scans one service_reports row in reportColumns order, decoding the
// two jsonb columns. sql.ErrNoRows becomes ErrNotFound so callers can tell an
// unknown id from a real failure.
//
// The parts of the decoded content are deliberately left as the jsonb carried
// them; callers that need the authoritative ordering overlay the parts_used
// rows (see getReport).
func scanReport(row scanner) (ReportRecord, error) {
	var (
		record       ReportRecord
		rawSchema    []byte
		rawContent   []byte
		jobID        sql.NullString
		technicianID sql.NullString
		submittedAt  sql.NullTime
		exportedAt   sql.NullTime
	)

	err := row.Scan(
		&record.ID,
		&record.TemplateID,
		&record.TemplateRevision,
		&rawSchema,
		&jobID,
		&technicianID,
		&record.Title,
		&record.CustomerName,
		&rawContent,
		&record.FilledBy,
		&record.Status,
		&submittedAt,
		&exportedAt,
		&record.CreatedAt,
		&record.UpdatedAt,
	)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return ReportRecord{}, ErrNotFound
		}
		return ReportRecord{}, fmt.Errorf("reports: scan report: %w", err)
	}

	if err := json.Unmarshal(rawSchema, &record.SchemaSnapshot); err != nil {
		return ReportRecord{}, fmt.Errorf("reports: unmarshal schema snapshot for %q: %w", record.ID, err)
	}
	if err := json.Unmarshal(rawContent, &record.Content); err != nil {
		return ReportRecord{}, fmt.Errorf("reports: unmarshal content for %q: %w", record.ID, err)
	}
	record.Content = record.Content.normalized()

	record.JobID = stringPtr(jobID)
	record.TechnicianID = stringPtr(technicianID)
	record.SubmittedAt = timePtr(submittedAt)
	record.ExportedAt = timePtr(exportedAt)
	return record, nil
}

// defaultTitle derives the title shown in the dashboard when the client did not
// supply one: "<template> — <customer>", or "<template> — <date>" when the
// report has no customer yet. An empty title would render as a blank row, which
// reads as a broken record rather than an unnamed one.
func defaultTitle(templateName, customerName string, now time.Time) string {
	if trimmed := strings.TrimSpace(customerName); trimmed != "" {
		return templateName + " — " + trimmed
	}
	return templateName + " — " + now.Format("2006-01-02")
}

// nullableString converts an optional string into the argument a nullable
// column expects: NULL for nil or empty, the value otherwise.
func nullableString(value *string) any {
	if value == nil || *value == "" {
		return nil
	}
	return *value
}

// stringPtr converts a scanned nullable string column into the *string the wire
// shape uses (JSON null when absent).
func stringPtr(value sql.NullString) *string {
	if !value.Valid {
		return nil
	}
	return &value.String
}

// timePtr converts a scanned nullable timestamp column into the *time.Time the
// wire shape uses (JSON null when absent).
func timePtr(value sql.NullTime) *time.Time {
	if !value.Valid {
		return nil
	}
	return &value.Time
}
