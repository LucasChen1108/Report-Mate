package reports

import (
	"database/sql"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strconv"
	"strings"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
	"github.com/LucasChen1108/Report-Mate/backend/internal/templates"
)

// createRequest is the JSON body accepted by POST /api/reports. The report is
// always stamped with the CALLER's identity as its technician, so there is no
// technicianId here — a client cannot file a report as someone else.
type createRequest struct {
	TemplateID   string        `json:"templateId"`
	JobID        *string       `json:"jobId"`
	Title        string        `json:"title"`
	CustomerName string        `json:"customerName"`
	Content      ReportContent `json:"content"`
}

// writeRequest is the JSON body accepted by PUT /api/reports/{id} and by
// POST /api/reports/{id}/save-and-export. The two carry identical bodies; they
// differ only in whether the content must be complete.
type writeRequest struct {
	Title        string        `json:"title"`
	CustomerName string        `json:"customerName"`
	Content      ReportContent `json:"content"`
}

// Handler serves the service_reports HTTP routes. It decodes and validates
// request bodies, delegates persistence to the Store and the save-and-export
// transaction to the Service, and maps every outcome onto the shared httpx
// envelopes.
type Handler struct {
	store   *Store
	service *Service
}

// NewHandler returns a Handler backed by db.
//
// The signature is fixed by cmd/server, which composes this package as
// reports.NewHandler(pool) and passes no configuration. The export directory is
// therefore read from the environment here, with the same default
// internal/config applies to EXPORT_DIR, rather than widening the seam.
func NewHandler(db *sql.DB) *Handler {
	store := NewStore(db)
	return &Handler{
		store:   store,
		service: NewService(store, exportDirFromEnv()),
	}
}

// RegisterRoutes mounts the reports routes onto mux using Go 1.22+ method +
// pattern routing. Write routes are size-limited by cmd/server, not here:
// report bodies carry inline base64 photos and are legitimately large.
//
// The patterns are the FULL paths even though cmd/server delegates the
// /api/reports subtree to this mux — ServeMux does not rewrite the path on the
// way through, so a trimmed pattern would match nothing.
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	mux.HandleFunc("POST /api/reports", h.handleCreate)
	mux.HandleFunc("GET /api/reports", h.handleList)
	mux.HandleFunc("GET /api/reports/{id}", h.handleGet)
	mux.HandleFunc("PUT /api/reports/{id}", h.handleUpdate)
	mux.HandleFunc("POST /api/reports/{id}/save-and-export", h.handleSaveAndExport)
	mux.HandleFunc("GET /api/reports/{id}/export", h.handleExport)
}

// handleCreate serves POST /api/reports. It snapshots the named template onto
// the new report and returns 201 with the persisted record.
//
// Content is validated with requireComplete = false: a report is created the
// moment a technician opens the form, long before anything is filled in.
func (h *Handler) handleCreate(w http.ResponseWriter, r *http.Request) {
	caller, ok := h.caller(w, r)
	if !ok {
		return
	}

	req, ok := decodeBody[createRequest](w, r)
	if !ok {
		return
	}

	templateID := strings.TrimSpace(req.TemplateID)
	if templateID == "" {
		httpx.WriteValidationError(w, "templateId is required", nil)
		return
	}
	if !isUUID(templateID) {
		httpx.WriteValidationError(w, "templateId is not a valid template identifier", nil)
		return
	}

	template, err := h.store.Template(r.Context(), templateID)
	if err != nil {
		if errors.Is(err, templates.ErrNotFound) {
			httpx.WriteError(w, http.StatusNotFound, "not_found", "template not found")
			return
		}
		writeStoreError(w, err)
		return
	}

	if err := ValidateContent(template.Schema, req.Content, false); err != nil {
		writeStoreError(w, err)
		return
	}

	record, err := h.store.Create(r.Context(), CreateParams{
		Template:     template,
		TechnicianID: caller.userID,
		JobID:        req.JobID,
		Title:        req.Title,
		CustomerName: req.CustomerName,
		Content:      req.Content,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, record)
}

// handleList serves GET /api/reports, newest first, with the filters described
// in parseListFilter and a total for pagination.
func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	caller, ok := h.caller(w, r)
	if !ok {
		return
	}

	filter, ok := parseListFilter(w, r)
	if !ok {
		return
	}
	// Stage A grants both roles Generate Report but defines no cross-user report
	// history permission. The authenticated identity therefore always wins over
	// a client-supplied technicianId for both roles.
	filter = scopeReportFilter(filter, caller)

	result, err := h.store.List(r.Context(), filter)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, result)
}

// handleGet serves GET /api/reports/{id}, with the parts_used rows merged back
// into the content.
func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request) {
	record, ok := h.loadOwned(w, r)
	if !ok {
		return
	}
	httpx.WriteJSON(w, http.StatusOK, record)
}

// handleUpdate serves PUT /api/reports/{id}: a DRAFT SAVE.
//
// Content is validated with requireComplete = false, which is the difference
// between a usable renderer and an unusable one — this is the route autosave
// calls, and a half-filled report must save cleanly. Structure and types are
// still enforced, and so is the unknown-key rule.
func (h *Handler) handleUpdate(w http.ResponseWriter, r *http.Request) {
	existing, ok := h.loadOwned(w, r)
	if !ok {
		return
	}

	req, ok := decodeBody[writeRequest](w, r)
	if !ok {
		return
	}

	// Validated against the report's own schema snapshot, never the template's
	// current schema: a since-edited template must not invalidate content that
	// was correct when it was written.
	if err := ValidateContent(existing.SchemaSnapshot, req.Content, false); err != nil {
		writeStoreError(w, err)
		return
	}

	record, err := h.store.Update(r.Context(), existing.ID, UpdateParams{
		Title:        req.Title,
		CustomerName: req.CustomerName,
		Content:      req.Content,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, record)
}

// handleSaveAndExport serves POST /api/reports/{id}/save-and-export: save the
// submitted content, require it to be COMPLETE, and produce the export
// document — all in one transaction (see Service.SaveAndExport).
//
// A missing required field answers 422 naming the field, and the report is left
// untouched as a draft.
func (h *Handler) handleSaveAndExport(w http.ResponseWriter, r *http.Request) {
	existing, ok := h.loadOwned(w, r)
	if !ok {
		return
	}

	req, ok := decodeBody[writeRequest](w, r)
	if !ok {
		return
	}

	response, err := h.service.SaveAndExport(r.Context(), existing.ID, UpdateParams{
		Title:        req.Title,
		CustomerName: req.CustomerName,
		Content:      req.Content,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

// handleExport serves GET /api/reports/{id}/export: the most recent rendered
// document for the report, as HTML.
//
// This response is NOT a JSON envelope — it is the document itself, which is
// the whole point of the endpoint. Its failures still are.
func (h *Handler) handleExport(w http.ResponseWriter, r *http.Request) {
	record, ok := h.loadOwned(w, r)
	if !ok {
		return
	}

	document, contentType, err := h.service.Export(r.Context(), record.ID)
	if err != nil {
		writeStoreError(w, err)
		return
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("Content-Length", strconv.Itoa(len(document)))
	// inline so the browser renders it rather than downloading it; the id is a
	// UUID, so the filename needs no escaping.
	w.Header().Set("Content-Disposition", `inline; filename="report-`+record.ID+`.html"`)
	w.WriteHeader(http.StatusOK)
	if _, err := w.Write(document); err != nil {
		log.Printf("reports: write export response: %v", err)
	}
}

// identity is the authenticated caller: who they are and what they may see.
type identity struct {
	userID string
}

// caller reads the authenticated identity off the request context. A request
// with no identity is UNAUTHENTICATED and answers 401 — it never falls back to
// a default user, which would silently file reports against whoever that
// happened to be (middleware.UserIDFromContext documents the same rule).
func (h *Handler) caller(w http.ResponseWriter, r *http.Request) (identity, bool) {
	userID, ok := middleware.UserIDFromContext(r.Context())
	if !ok || userID == "" {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthenticated", "authentication is required")
		return identity{}, false
	}
	return identity{userID: userID}, true
}

// loadOwned resolves the {id} path value, loads the report, and enforces that
// the caller may see it. It is the shared front half of every single-report
// route, so the identity check, the 404 and the ownership rule cannot be
// applied to four routes and forgotten on the fifth.
//
// Both roles may reach only reports created under their own identity. Stage A
// does not grant Admins organization-wide report-history access.
func (h *Handler) loadOwned(w http.ResponseWriter, r *http.Request) (ReportRecord, bool) {
	caller, ok := h.caller(w, r)
	if !ok {
		return ReportRecord{}, false
	}

	id := r.PathValue("id")
	if !isUUID(id) {
		// A malformed id cannot name a report, and answering 404 keeps the
		// response identical to an id that simply does not exist.
		httpx.WriteError(w, http.StatusNotFound, "not_found", "report not found")
		return ReportRecord{}, false
	}

	record, err := h.store.Get(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return ReportRecord{}, false
	}

	if !ownsReport(caller, record) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "report not found")
		return ReportRecord{}, false
	}
	return record, true
}

func scopeReportFilter(filter ListFilter, caller identity) ListFilter {
	filter.TechnicianID = caller.userID
	return filter
}

func ownsReport(caller identity, record ReportRecord) bool {
	return record.TechnicianID != nil && *record.TechnicianID == caller.userID
}

// decodeBody reads and decodes the JSON request body into T. A body that fails
// to decode into the expected shape — malformed JSON, a wrong-typed field, an
// unrecognized key, or a body over the size limit cmd/server imposes — is
// reported as a 400 and ok is false, exactly as templates/handler.go does it.
//
// Unknown keys are refused rather than ignored, which is the same principle the
// content validator applies to field ids: a client sending a key nobody reads
// should be told, not quietly half-served.
func decodeBody[T any](w http.ResponseWriter, r *http.Request) (T, bool) {
	var body T
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&body); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.ValidationCode, "request body could not be decoded")
		return body, false
	}
	return body, true
}

// parseListFilter reads the GET /api/reports query parameters:
//
//	templateId   — only reports filled against this template
//	status       — draft | submitted | exported
//	technicianId — only this technician's reports
//	from, to     — created_at window; a date (YYYY-MM-DD), `to` inclusive of
//	               that whole day
//	q            — free text over the title and customer name
//	limit        — 1..100, default 25
//	offset       — 0 or more
//
// A malformed parameter is a 400 rather than being silently dropped: a filter
// that is ignored returns confidently wrong results, which is worse than an
// error.
func parseListFilter(w http.ResponseWriter, r *http.Request) (ListFilter, bool) {
	query := r.URL.Query()
	filter := ListFilter{Query: query.Get("q")}

	if value := strings.TrimSpace(query.Get("templateId")); value != "" {
		if !isUUID(value) {
			httpx.WriteError(w, http.StatusBadRequest, httpx.ValidationCode, "templateId is not a valid identifier")
			return ListFilter{}, false
		}
		filter.TemplateID = value
	}

	if value := strings.TrimSpace(query.Get("technicianId")); value != "" {
		if !isUUID(value) {
			httpx.WriteError(w, http.StatusBadRequest, httpx.ValidationCode, "technicianId is not a valid identifier")
			return ListFilter{}, false
		}
		filter.TechnicianID = value
	}

	if value := strings.TrimSpace(query.Get("status")); value != "" {
		switch value {
		case StatusDraft, StatusSubmitted, StatusExported:
			filter.Status = value
		default:
			httpx.WriteError(w, http.StatusBadRequest, httpx.ValidationCode, "status must be draft, submitted or exported")
			return ListFilter{}, false
		}
	}

	from, ok := parseDayParam(w, query.Get("from"), "from", false)
	if !ok {
		return ListFilter{}, false
	}
	filter.From = from

	// A "to" is read as the END of that day, so ?to=2026-09-21 includes the
	// reports filed on the 21st rather than none of them.
	to, ok := parseDayParam(w, query.Get("to"), "to", true)
	if !ok {
		return ListFilter{}, false
	}
	filter.To = to

	if value := strings.TrimSpace(query.Get("limit")); value != "" {
		limit, err := strconv.Atoi(value)
		if err != nil || limit < 1 {
			httpx.WriteError(w, http.StatusBadRequest, httpx.ValidationCode, "limit must be a positive whole number")
			return ListFilter{}, false
		}
		filter.Limit = limit
	}

	if value := strings.TrimSpace(query.Get("offset")); value != "" {
		offset, err := strconv.Atoi(value)
		if err != nil || offset < 0 {
			httpx.WriteError(w, http.StatusBadRequest, httpx.ValidationCode, "offset must be zero or a positive whole number")
			return ListFilter{}, false
		}
		filter.Offset = offset
	}

	return filter, true
}

// parseDayParam parses a created_at window bound and answers 400 on anything
// that is not a YYYY-MM-DD day.
//
// IT USED TO ALSO ACCEPT RFC 3339, AND DELIBERATELY NO LONGER DOES. The two
// formats carried different inclusivity — `?to=2026-09-21` meant through the
// end of the 21st, `?to=2026-09-21T00:00:00Z` meant up to its start — so the
// same parameter meant two things a day apart with nothing in the request to
// distinguish them. Worse, GET /api/dashboard/templates/{id} took the same
// parameter names and rejected the instant form outright, so two endpoints
// the frontend treats as interchangeable disagreed. httpx.ParseDayBound is
// now the single parser behind both; see its doc comment for the semantics
// and for the UTC caveat that applies equally to each.
//
// No caller loses anything: every date filter in the product originates from
// an <input type="date">, which emits YYYY-MM-DD.
func parseDayParam(w http.ResponseWriter, raw, name string, exclusiveEnd bool) (*time.Time, bool) {
	bound, err := httpx.ParseDayBound(raw, exclusiveEnd)
	if err != nil {
		httpx.WriteError(w, http.StatusBadRequest, httpx.ValidationCode, httpx.DayBoundMessage(name))
		return nil, false
	}
	return bound, true
}

// isUUID reports whether value has the canonical 8-4-4-4-12 hexadecimal UUID
// form. Ids reach SQL as uuid-typed parameters, so a malformed one would
// otherwise come back as a driver error and be reported as a 500 — a client
// mistake dressed up as a server fault.
func isUUID(value string) bool {
	const uuidLength = 36
	if len(value) != uuidLength {
		return false
	}
	for i := 0; i < uuidLength; i++ {
		c := value[i]
		if i == 8 || i == 13 || i == 18 || i == 23 {
			if c != '-' {
				return false
			}
			continue
		}
		isHex := (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F')
		if !isHex {
			return false
		}
	}
	return true
}

// writeStoreError maps an error from the store, the validator, or the export
// path onto a response.
//
// A *ValidationError becomes the same 422 body the template builder already
// handles, naming the offending field id in elementId. ErrNotFound becomes a
// 404, ErrNoExport a 404 that says which thing is missing, and anything else a
// generic 500 — with the real error logged server-side and never leaked to the
// client.
func writeStoreError(w http.ResponseWriter, err error) {
	var verr *ValidationError
	if errors.As(err, &verr) {
		httpx.WriteValidationError(w, verr.Message, elementIDPtr(verr.Element))
		return
	}

	switch {
	case errors.Is(err, ErrNotFound), errors.Is(err, templates.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not_found", "report not found")
		return
	case errors.Is(err, ErrNoExport):
		httpx.WriteError(w, http.StatusNotFound, "not_found", "this report has not been exported yet")
		return
	}

	log.Printf("reports: %v", err)
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "internal server error")
}

// elementIDPtr converts a ValidationError.Element into the *string the JSON
// body expects: an empty element becomes null, a named element a pointer to
// that id.
func elementIDPtr(element string) *string {
	if element == "" {
		return nil
	}
	return &element
}
