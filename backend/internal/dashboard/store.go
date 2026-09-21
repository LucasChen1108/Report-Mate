package dashboard

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"

	// pgx stdlib driver registers itself as the "pgx" database/sql driver; the
	// pool itself is opened in cmd/server and handed to NewHandler.
	_ "github.com/jackc/pgx/v5/stdlib"
)

// ErrTemplateNotFound is returned when no report_templates row matches the
// requested id. The handler maps it to a 404.
var ErrTemplateNotFound = errors.New("dashboard: template not found")

// maxExportRows caps a CSV export. An export is unpaginated by design, but
// "unpaginated" must not mean "unbounded": one query that tries to materialize
// every report a user has ever filed would hold a connection for as long as it
// takes and buffer the lot in memory.
const maxExportRows = 5000

// --- Wire DTOs ---------------------------------------------------------------
//
// These mirror frontend/src/api/reportTypes.ts field for field. That file is
// frozen and four agents compile against it, so the json tags below are a
// contract: renaming one breaks the dashboard screens silently, at runtime.

// TemplateRollup is one dashboard card: a template plus the counts of the
// calling user's reports filed against it. Mirrors DashboardTemplateRollup.
type TemplateRollup struct {
	TemplateID     string     `json:"templateId"`
	Name           string     `json:"name"`
	IsSeed         bool       `json:"isSeed"`
	Revision       int        `json:"revision"`
	ReportCount    int        `json:"reportCount"`
	DraftCount     int        `json:"draftCount"`
	SubmittedCount int        `json:"submittedCount"`
	ExportedCount  int        `json:"exportedCount"`
	LastReportAt   *time.Time `json:"lastReportAt"`
}

// TableColumn is one column of the report table — one field of the template's
// CURRENT schema. Type is a presentation hint (alignment, width) only: the cell
// is already a display string by the time it reaches the client. Mirrors
// ReportTableColumn.
type TableColumn struct {
	FieldID      string              `json:"fieldId"`
	Label        string              `json:"label"`
	Type         templates.FieldType `json:"type"`
	SectionLabel string              `json:"sectionLabel"`
}

// TableRow is one past report as a row of the table. Cells is keyed by field id
// and every column is present in it — a field the report has no value for
// carries the missing marker rather than being omitted. Mirrors
// ReportTableRow.
type TableRow struct {
	ReportID         string            `json:"reportId"`
	CreatedAt        time.Time         `json:"createdAt"`
	Status           string            `json:"status"`
	TemplateRevision int               `json:"templateRevision"`
	CustomerName     string            `json:"customerName"`
	Cells            map[string]string `json:"cells"`
	// StaleRevision is true when the report was filled against an older
	// revision of the template than the one the columns come from, so some
	// columns legitimately have no data for it. The UI badges these rather
	// than hiding them.
	StaleRevision bool `json:"staleRevision"`
}

// TableTemplate is the template identity carried on a TableView.
type TableTemplate struct {
	ID       string `json:"id"`
	Name     string `json:"name"`
	Revision int    `json:"revision"`
}

// TableView is the full per-template report table: its columns, one page of
// rows, and the paging window that produced them. Total is the count of rows
// matching the filters, NOT the size of this page. Mirrors ReportTableView.
type TableView struct {
	Template TableTemplate `json:"template"`
	Columns  []TableColumn `json:"columns"`
	Rows     []TableRow    `json:"rows"`
	Total    int           `json:"total"`
	Limit    int           `json:"limit"`
	Offset   int           `json:"offset"`
}

// --- Internal row shapes -----------------------------------------------------

// templateMeta is the template as the table endpoint needs it: identity, the
// current revision to compare rows against, and the schema the columns come
// from.
type templateMeta struct {
	ID       string
	Name     string
	Revision int
	Schema   templates.TemplateSchema
}

// reportRow is one service_reports row as it comes back from the database.
//
// Values holds the report's field values with every photo/signature key already
// removed by Postgres; Attachments carries, for exactly those removed keys, a
// flag saying whether the report had anything in them. Splitting it this way is
// what lets a cell say "Photo" or "" without the row ever carrying a megabyte
// of base64 (see reportsFromSQL).
type reportRow struct {
	ID               string
	CreatedAt        time.Time
	Status           string
	TemplateRevision int
	CustomerName     string
	Values           map[string]json.RawMessage
	Attachments      map[string]bool
}

// reportFilter is the WHERE-clause half of a report table query: what to show,
// and — non-negotiably — whose reports. UserID is never optional and never
// role-dependent.
type reportFilter struct {
	TemplateID string
	UserID     string
	// StripKeys are the field ids whose values must not leave the database:
	// every photo and signature field of the template's schema.
	StripKeys []string
	// Status is one of draft/submitted/exported, or "" for every status.
	Status string
	// From is an inclusive lower bound and To an EXCLUSIVE upper bound on
	// created_at; the handler turns the inclusive YYYY-MM-DD the client sends
	// into that half-open interval. Either may be nil.
	From *time.Time
	To   *time.Time
	// Search is a case-insensitive substring matched against the customer, the
	// title and the (stripped) values; "" matches everything.
	Search string
}

// args returns the seven positional parameters shared by the rows and count
// queries, in the order reportsFromSQL numbers them.
func (f reportFilter) args() ([]any, error) {
	// A nil slice marshals to "null", which jsonb_array_elements_text rejects;
	// an empty list must serialize as [].
	keys := f.StripKeys
	if keys == nil {
		keys = []string{}
	}
	stripJSON, err := json.Marshal(keys)
	if err != nil {
		return nil, fmt.Errorf("dashboard: marshal strip keys: %w", err)
	}

	return []any{
		f.TemplateID,      // $1
		f.UserID,          // $2
		string(stripJSON), // $3
		f.Status,          // $4
		nullTime(f.From),  // $5
		nullTime(f.To),    // $6
		f.Search,          // $7
	}, nil
}

// nullTime converts an optional bound into the NULL-able argument the query's
// "$n IS NULL OR ..." guards expect.
func nullTime(t *time.Time) any {
	if t == nil {
		return nil
	}
	return *t
}

// --- Store -------------------------------------------------------------------

// store owns every dashboard query. It is unexported because cmd/server
// composes the package as dashboard.NewHandler(pool) — the pool is the seam,
// not the store.
type store struct {
	db *sql.DB
}

// newStore returns a store backed by db (a *sql.DB opened against PostgreSQL).
func newStore(db *sql.DB) *store {
	return &store{db: db}
}

// rollupsQuery aggregates every live template against the calling user's
// reports.
//
// TWO TRAPS, both silent, both load-bearing:
//
//   - count(r.id), never count(*). With a LEFT JOIN, count(*) counts the
//     synthesized all-NULL row too and reports 1 for a template that has no
//     reports at all.
//   - the technician filter lives in the JOIN's ON clause, never in WHERE. In
//     WHERE it degrades the LEFT JOIN to an inner join and every zero-report
//     template — the "start a report here" cards — disappears from the list.
const rollupsQuery = `
	SELECT t.id, t.name, t.is_seed, t.revision,
	       count(r.id)                                       AS report_count,
	       count(r.id) FILTER (WHERE r.status = 'draft')     AS draft_count,
	       count(r.id) FILTER (WHERE r.status = 'submitted') AS submitted_count,
	       count(r.id) FILTER (WHERE r.status = 'exported')  AS exported_count,
	       max(r.created_at)                                 AS last_report_at
	FROM report_templates t
	LEFT JOIN service_reports r
	       ON r.template_id = t.id AND r.technician_id = $1
	WHERE t.archived_at IS NULL
	GROUP BY t.id
	ORDER BY last_report_at DESC NULLS LAST, t.name`

// rollups returns one card per non-archived template, most recent activity
// first, counting only userID's reports.
func (s *store) rollups(ctx context.Context, userID string) ([]TemplateRollup, error) {
	rows, err := s.db.QueryContext(ctx, rollupsQuery, userID)
	if err != nil {
		return nil, fmt.Errorf("dashboard: rollups: %w", err)
	}
	defer rows.Close()

	rollups := make([]TemplateRollup, 0)
	for rows.Next() {
		var (
			rollup TemplateRollup
			last   sql.NullTime
		)
		if err := rows.Scan(
			&rollup.TemplateID, &rollup.Name, &rollup.IsSeed, &rollup.Revision,
			&rollup.ReportCount, &rollup.DraftCount, &rollup.SubmittedCount,
			&rollup.ExportedCount, &last,
		); err != nil {
			return nil, fmt.Errorf("dashboard: rollups scan: %w", err)
		}
		if last.Valid {
			t := last.Time
			rollup.LastReportAt = &t
		}
		rollups = append(rollups, rollup)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("dashboard: rollups rows: %w", err)
	}
	return rollups, nil
}

// templateQuery loads the template the table is built from. Archived templates
// are deliberately still readable: archiving hides a template from the list of
// things to fill in, it does not delete the history filed against it.
const templateQuery = `
	SELECT id, name, revision, schema
	FROM report_templates
	WHERE id = $1`

// template returns the template's identity, current revision and schema, or
// ErrTemplateNotFound when no row matches id.
func (s *store) template(ctx context.Context, id string) (templateMeta, error) {
	var (
		meta      templateMeta
		rawSchema []byte
	)
	err := s.db.QueryRowContext(ctx, templateQuery, id).
		Scan(&meta.ID, &meta.Name, &meta.Revision, &rawSchema)
	if err != nil {
		if errors.Is(err, sql.ErrNoRows) {
			return templateMeta{}, ErrTemplateNotFound
		}
		return templateMeta{}, fmt.Errorf("dashboard: template: %w", err)
	}
	if err := json.Unmarshal(rawSchema, &meta.Schema); err != nil {
		return templateMeta{}, fmt.Errorf("dashboard: template unmarshal schema for %q: %w", id, err)
	}
	return meta, nil
}

// reportsFromSQL is the FROM + WHERE shared by the rows query and the count
// query, so the two can never drift into disagreeing about what "total" counts.
//
// The three LATERALs are plumbing, evaluated once per row:
//
//	p.strip  the photo/signature field ids, as text[]. They arrive as a JSON
//	         array in $3 rather than a driver-encoded array so the query does
//	         not depend on how the sql driver renders []string.
//	v.vals   content -> 'values', guarded: a report whose content is missing
//	         that key, or holds a non-object there, must not error the query.
//	c.cells  v.vals with the attachment keys REMOVED, by jsonb's `-` operator.
//
// c.cells is the load-bearing one. Photos and signatures are inline base64 data
// URLs; a 2 MB photo is ~2.7 MB of text. Stripping them here means the bytes
// are never sent to the application at all — without it a 15-row page is tens
// of megabytes and the screen is unusable.
const reportsFromSQL = `
	FROM service_reports r
	CROSS JOIN LATERAL (
	        SELECT ARRAY(SELECT jsonb_array_elements_text($3::jsonb)) AS strip
	) p
	CROSS JOIN LATERAL (
	        SELECT CASE WHEN jsonb_typeof(r.content -> 'values') = 'object'
	                    THEN r.content -> 'values'
	                    ELSE '{}'::jsonb END AS vals
	) v
	CROSS JOIN LATERAL (
	        SELECT v.vals - p.strip AS cells
	) c
	WHERE r.template_id = $1
	  AND r.technician_id = $2
	  AND ($4 = '' OR r.status = $4)
	  AND ($5::timestamptz IS NULL OR r.created_at >= $5::timestamptz)
	  AND ($6::timestamptz IS NULL OR r.created_at <  $6::timestamptz)
	  AND ($7 = ''
	       OR strpos(lower(r.customer_name), lower($7)) > 0
	       OR strpos(lower(r.title), lower($7)) > 0
	       OR strpos(lower(c.cells::text), lower($7)) > 0)`

// attachmentPresenceSQL summarizes the keys c.cells threw away: for each
// attachment field the report actually has a key for, a boolean saying whether
// there is anything in it. That is how a cell can render "Photo" or "Signed"
// without the data, and how an attachment field MISSING from an older report is
// still distinguishable from one that is present but empty.
const attachmentPresenceSQL = `
	        (SELECT coalesce(jsonb_object_agg(e.key, to_jsonb(
	                    CASE jsonb_typeof(e.value)
	                        WHEN 'null'   THEN false
	                        WHEN 'string' THEN (e.value #>> '{}') <> ''
	                        WHEN 'array'  THEN jsonb_array_length(e.value) > 0
	                        WHEN 'object' THEN e.value <> '{}'::jsonb
	                        ELSE true
	                    END)), '{}'::jsonb)
	         FROM jsonb_each(v.vals) e
	         WHERE e.key = ANY(p.strip)) AS attachments`

// reportsQuery is one page of rows, newest first. The id tiebreaker keeps
// paging stable when two reports share a created_at.
const reportsQuery = `
	SELECT r.id, r.created_at, r.status, r.template_revision, r.customer_name,
	       c.cells,
` + attachmentPresenceSQL + `
` + reportsFromSQL + `
	ORDER BY r.created_at DESC, r.id DESC
	LIMIT $8 OFFSET $9`

// countReportsQuery is the same filter without the window, for the pagination
// total.
const countReportsQuery = `
	SELECT count(*)
` + reportsFromSQL

// reports returns one page of the calling user's reports for a template.
func (s *store) reports(ctx context.Context, filter reportFilter, limit, offset int) ([]reportRow, error) {
	args, err := filter.args()
	if err != nil {
		return nil, err
	}
	args = append(args, limit, offset)

	rows, err := s.db.QueryContext(ctx, reportsQuery, args...)
	if err != nil {
		return nil, fmt.Errorf("dashboard: reports: %w", err)
	}
	defer rows.Close()

	out := make([]reportRow, 0, limit)
	for rows.Next() {
		var (
			row            reportRow
			rawValues      []byte
			rawAttachments []byte
		)
		if err := rows.Scan(
			&row.ID, &row.CreatedAt, &row.Status, &row.TemplateRevision,
			&row.CustomerName, &rawValues, &rawAttachments,
		); err != nil {
			return nil, fmt.Errorf("dashboard: reports scan: %w", err)
		}
		if err := json.Unmarshal(rawValues, &row.Values); err != nil {
			return nil, fmt.Errorf("dashboard: reports unmarshal values for %q: %w", row.ID, err)
		}
		if err := json.Unmarshal(rawAttachments, &row.Attachments); err != nil {
			return nil, fmt.Errorf("dashboard: reports unmarshal attachments for %q: %w", row.ID, err)
		}
		out = append(out, row)
	}
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("dashboard: reports rows: %w", err)
	}
	return out, nil
}

// countReports returns how many reports match the filter, ignoring paging.
func (s *store) countReports(ctx context.Context, filter reportFilter) (int, error) {
	args, err := filter.args()
	if err != nil {
		return 0, err
	}

	var total int
	if err := s.db.QueryRowContext(ctx, countReportsQuery, args...).Scan(&total); err != nil {
		return 0, fmt.Errorf("dashboard: count reports: %w", err)
	}
	return total, nil
}
