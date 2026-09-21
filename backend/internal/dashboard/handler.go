package dashboard

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
)

// Paging bounds for the report table. The cap is a payload guard, not a
// preference: rows carry one cell per template field, and a template may have
// hundreds.
const (
	defaultLimit = 25
	maxLimit     = 100
)

// reportStatuses are the values service_reports.status may take; its check
// constraint enforces the same list. An unknown status filter is rejected
// rather than quietly returning zero rows, which looks identical to "you have
// no reports" in the UI.
var reportStatuses = map[string]bool{
	"draft":     true,
	"submitted": true,
	"exported":  true,
}

// Handler serves the dashboard HTTP routes. It holds the store built over the
// pool cmd/server hands it; NewHandler(*sql.DB) and RegisterRoutes(*ServeMux)
// are the fixed composition seam.
type Handler struct {
	store *store
}

// NewHandler returns a Handler backed by db.
func NewHandler(db *sql.DB) *Handler {
	return &Handler{store: newStore(db)}
}

// RegisterRoutes mounts the dashboard routes onto mux using Go 1.22+ method +
// pattern routing. Every route is a read, and every route is scoped to the
// calling user — there is no role gate, because there is nothing here a user is
// allowed to see that is not already their own.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/dashboard/templates", h.handleRollups)
	mux.HandleFunc("GET /api/dashboard/templates/{id}", h.handleTable)
	mux.HandleFunc("GET /api/dashboard/templates/{id}/export.csv", h.handleExportCSV)
}

// handleRollups serves GET /api/dashboard/templates: one card per live
// template, including the ones this user has never filed a report against.
func (h *Handler) handleRollups(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}

	rollups, err := h.store.rollups(r.Context(), userID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, rollups)
}

// handleTable serves GET /api/dashboard/templates/{id}: the template's fields
// as columns and this user's reports as rows, filtered and paged.
func (h *Handler) handleTable(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	templateID, ok := requireTemplateID(w, r)
	if !ok {
		return
	}
	params, err := parseTableParams(r.URL.Query())
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}

	view, err := h.buildView(r.Context(), userID, templateID, params, params.limit, params.offset)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, view)
}

// handleExportCSV serves GET /api/dashboard/templates/{id}/export.csv: the same
// columns and the same filters as the table, unpaged, as a CSV download.
//
// The rows are fetched in full before a single byte of the response is written.
// Streaming them would mean a database error halfway through arriving after a
// 200 and a header row, which reaches the user as a truncated file that looks
// like real data.
func (h *Handler) handleExportCSV(w http.ResponseWriter, r *http.Request) {
	userID, ok := requireUser(w, r)
	if !ok {
		return
	}
	templateID, ok := requireTemplateID(w, r)
	if !ok {
		return
	}
	params, err := parseTableParams(r.URL.Query())
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "bad_request", err.Error())
		return
	}

	// An export covers the whole filtered set, so the caller's paging window is
	// ignored — bounded only by the export cap.
	view, err := h.buildView(r.Context(), userID, templateID, params, maxExportRows, 0)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	filename := csvFilename(view.Template.Name, time.Now())
	w.Header().Set("Content-Type", "text/csv; charset=utf-8")
	w.Header().Set("Content-Disposition", fmt.Sprintf("attachment; filename=%q", filename))
	w.WriteHeader(http.StatusOK)

	if err := writeCSV(w, view); err != nil {
		// The status line is already committed, so there is no error response
		// left to send; log it and let the truncated download fail visibly.
		log.Printf("dashboard: write csv for template %s: %v", templateID, err)
	}
}

// buildView is the shared body of both table endpoints: load the template,
// derive the columns from its current schema, count and fetch this user's
// matching reports, and flatten every cell to a display string.
func (h *Handler) buildView(ctx context.Context, userID, templateID string, params tableParams, limit, offset int) (TableView, error) {
	meta, err := h.store.template(ctx, templateID)
	if err != nil {
		return TableView{}, err
	}

	columns := flattenColumns(meta.Schema)
	filter := reportFilter{
		TemplateID: meta.ID,
		UserID:     userID,
		StripKeys:  attachmentFieldIDs(meta.Schema),
		Status:     params.status,
		From:       params.from,
		To:         params.to,
		Search:     params.search,
	}

	total, err := h.store.countReports(ctx, filter)
	if err != nil {
		return TableView{}, err
	}
	rows, err := h.store.reports(ctx, filter, limit, offset)
	if err != nil {
		return TableView{}, err
	}

	tableRows := make([]TableRow, 0, len(rows))
	for _, row := range rows {
		tableRows = append(tableRows, buildRow(columns, row, meta.Revision))
	}

	return TableView{
		Template: TableTemplate{ID: meta.ID, Name: meta.Name, Revision: meta.Revision},
		Columns:  columns,
		Rows:     tableRows,
		Total:    total,
		Limit:    limit,
		Offset:   offset,
	}, nil
}

// tableParams is the parsed query string of both table endpoints.
type tableParams struct {
	status string
	// from is an inclusive lower bound and to an EXCLUSIVE upper bound on
	// created_at. The client sends inclusive calendar days; parseTableParams
	// turns `to` into the start of the following day so the whole of that day
	// is included, which a plain `<= to` would not do (it would cut the day off
	// at midnight and silently drop every report filed during it).
	from   *time.Time
	to     *time.Time
	search string
	limit  int
	offset int
}

// parseTableParams reads and validates status/from/to/q/limit/offset. Dates are
// interpreted as UTC days by httpx.ParseDayBound, the same parser
// GET /api/reports uses. Returned errors are safe to show the caller: they
// describe the caller's own input and nothing else.
func parseTableParams(query url.Values) (tableParams, error) {
	params := tableParams{
		status: strings.TrimSpace(query.Get("status")),
		search: strings.TrimSpace(query.Get("q")),
		limit:  defaultLimit,
	}

	if params.status != "" && !reportStatuses[params.status] {
		return tableParams{}, errors.New("status must be one of draft, submitted, exported")
	}

	// Both bounds go through httpx.ParseDayBound, which is also what
	// GET /api/reports uses — the two endpoints take the same-looking
	// parameters and must not answer differently for the same URL.
	from, err := httpx.ParseDayBound(query.Get("from"), false)
	if err != nil {
		return tableParams{}, errors.New(httpx.DayBoundMessage("from"))
	}
	params.from = from

	// `to` is parsed as an EXCLUSIVE end: the start of the following day, so
	// the named day is fully included. See ParseDayBound.
	to, err := httpx.ParseDayBound(query.Get("to"), true)
	if err != nil {
		return tableParams{}, errors.New(httpx.DayBoundMessage("to"))
	}
	params.to = to

	if raw := strings.TrimSpace(query.Get("limit")); raw != "" {
		limit, err := strconv.Atoi(raw)
		if err != nil || limit < 1 {
			return tableParams{}, errors.New("limit must be a positive integer")
		}
		// Over the cap is clamped rather than rejected: asking for more rows
		// than we serve is a reasonable request to answer with fewer.
		params.limit = min(limit, maxLimit)
	}

	if raw := strings.TrimSpace(query.Get("offset")); raw != "" {
		offset, err := strconv.Atoi(raw)
		if err != nil || offset < 0 {
			return tableParams{}, errors.New("offset must be a non-negative integer")
		}
		params.offset = offset
	}

	return params, nil
}

// requireUser resolves the calling user's id, answering 401 when the request
// carries no identity. Every dashboard query needs it — this is the only source
// of the technician_id every query is scoped by, and there is deliberately no
// fallback: substituting a default user here would serve one person's reports
// to another.
func requireUser(w http.ResponseWriter, r *http.Request) (string, bool) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok || userID == "" {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthorized", "authentication required")
		return "", false
	}
	return userID, true
}

// requireTemplateID reads the {id} path value and rejects anything that is not
// a UUID. Passing a malformed id straight to Postgres would come back as a
// "invalid input syntax for type uuid" error and surface as a 500; a bad id in
// a URL is a missing template, not a server fault.
func requireTemplateID(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !isUUID(id) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "template not found")
		return "", false
	}
	return id, true
}

// isUUID reports whether s is a canonical 8-4-4-4-12 hex UUID. It is written
// out rather than pulled in as a dependency: this is the only place the backend
// needs to recognize one.
func isUUID(s string) bool {
	if len(s) != 36 {
		return false
	}
	for i, r := range s {
		switch i {
		case 8, 13, 18, 23:
			if r != '-' {
				return false
			}
		default:
			isHex := (r >= '0' && r <= '9') || (r >= 'a' && r <= 'f') || (r >= 'A' && r <= 'F')
			if !isHex {
				return false
			}
		}
	}
	return true
}

// writeStoreError maps a store error to a response: an unknown template becomes
// a 404, anything else a 500 with a generic message while the real error is
// logged server-side and never leaked to the client.
func writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrTemplateNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "template not found")
		return
	}
	log.Printf("dashboard: store error: %v", err)
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "internal server error")
}
