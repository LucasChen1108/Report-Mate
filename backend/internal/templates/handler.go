package templates

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"strings"

	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
)

// dispatcherAdminRole is the role permitted to perform report_templates write
// operations. It matches the value the RBAC middleware checks against
// (Requirements 6.1, 6.3).
const dispatcherAdminRole = "dispatcher_admin"

// templateRequest is the JSON body accepted by the create and update routes: a
// template name plus the Template Schema to persist. Decoding a body whose
// shape does not match (for example a non-boolean "required" inside the schema)
// fails here and is reported as a 400, before validation is attempted.
type templateRequest struct {
	Name   string         `json:"name"`
	Schema TemplateSchema `json:"schema"`
}

// Handler serves the report_templates HTTP routes. It decodes and validates
// request bodies, delegates persistence to the Store, and maps outcomes to the
// status codes defined in the design's Error Handling section.
type Handler struct {
	store Store
}

// NewHandler returns a Handler backed by store.
func NewHandler(store Store) *Handler {
	return &Handler{store: store}
}

// RegisterRoutes mounts the templates routes onto mux using Go 1.22+ method +
// pattern routing. Read routes (GET) are ungated by role; write routes (POST,
// PUT) are wrapped with the dispatcher-admin RBAC middleware so a non
// dispatcher-admin never reaches the handler (Requirements 6.1, 6.3).
func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	requireDispatcherAdmin := middleware.RequireRole(dispatcherAdminRole)

	mux.HandleFunc("GET /api/templates", h.handleList)
	mux.HandleFunc("GET /api/templates/{id}", h.handleGet)
	mux.Handle("POST /api/templates", requireDispatcherAdmin(http.HandlerFunc(h.handleCreate)))
	mux.Handle("PUT /api/templates/{id}", requireDispatcherAdmin(http.HandlerFunc(h.handleUpdate)))
}

// handleList serves GET /api/templates. Any authenticated user may list
// templates (Requirements 5.4, 7.3).
func (h *Handler) handleList(w http.ResponseWriter, r *http.Request) {
	summaries, err := h.store.List(r.Context())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, summaries)
}

// handleGet serves GET /api/templates/{id}. Any authenticated user may load a
// template (Requirement 5.2). An unknown id maps to 404.
func (h *Handler) handleGet(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	record, err := h.store.Get(r.Context(), id)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, record)
}

// handleCreate serves POST /api/templates. It decodes the body, validates the
// name and schema, and only on success creates the record, returning 201
// (Requirements 5.1, 1.8, 1.9, 1.11, 1.12, 1.13).
func (h *Handler) handleCreate(w http.ResponseWriter, r *http.Request) {
	req, ok := decodeRequest(w, r)
	if !ok {
		return
	}
	if !validateRequest(w, req) {
		return
	}

	record, err := h.store.Create(r.Context(), req.Name, req.Schema)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, record)
}

// handleUpdate serves PUT /api/templates/{id}. It decodes the body, validates
// the name and schema, and only on success updates the record, returning 200.
// An unknown id maps to 404 (Requirements 5.3, 1.8, 1.9, 1.11, 1.12, 1.13).
func (h *Handler) handleUpdate(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")

	req, ok := decodeRequest(w, r)
	if !ok {
		return
	}
	if !validateRequest(w, req) {
		return
	}

	record, err := h.store.Update(r.Context(), id, req.Name, req.Schema)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, record)
}

// decodeRequest reads and decodes the JSON request body into a templateRequest.
// A body that fails to decode into the expected shape (malformed JSON, or a
// wrong-typed field such as a non-boolean "required") is reported as a 400 and
// decodeRequest returns ok == false; validation is not attempted (design Error
// Handling: "Malformed JSON / wrong types (400)").
func decodeRequest(w http.ResponseWriter, r *http.Request) (templateRequest, bool) {
	var req templateRequest
	dec := json.NewDecoder(r.Body)
	dec.DisallowUnknownFields()
	if err := dec.Decode(&req); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "bad_request", "request body could not be decoded")
		return templateRequest{}, false
	}
	return req, true
}

// validateRequest enforces the empty-name backstop (Req 5.5) and then runs the
// schema validator. On any failure it writes a 422 validation_error naming the
// offending element (null when structural) and returns false; the store is
// never touched on a validation failure (no partial persist). It returns true
// when the request is valid.
func validateRequest(w http.ResponseWriter, req templateRequest) bool {
	// Empty template name backstop (Req 5.5). The name carries no element id,
	// so elementId is reported as null.
	if strings.TrimSpace(req.Name) == "" {
		httpx.WriteValidationError(w, "template name is required", nil)
		return false
	}

	if err := Validate(req.Schema); err != nil {
		var verr *ValidationError
		if errors.As(err, &verr) {
			httpx.WriteValidationError(w, verr.Message, elementIDPtr(verr.Element))
			return false
		}
		// Validate only ever returns *ValidationError or nil; a non
		// *ValidationError is unexpected. Treat it as an internal error rather
		// than leaking details.
		log.Printf("templates: unexpected validate error: %v", err)
		httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "internal server error")
		return false
	}
	return true
}

// elementIDPtr converts a ValidationError.Element into the *string the JSON
// body expects: an empty element becomes null, a named element becomes a
// pointer to that id.
func elementIDPtr(element string) *string {
	if element == "" {
		return nil
	}
	return &element
}

// writeStoreError maps a Store error to the appropriate response: ErrNotFound
// becomes a 404, and any other error becomes a 500 with a generic message while
// the underlying detail is logged server-side and never leaked to the client.
func writeStoreError(w http.ResponseWriter, err error) {
	if errors.Is(err, ErrNotFound) {
		httpx.WriteError(w, http.StatusNotFound, "not_found", "template not found")
		return
	}
	log.Printf("templates: store error: %v", err)
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "internal server error")
}
