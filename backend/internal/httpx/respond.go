// Package httpx holds the shared HTTP response helpers every domain handler
// writes through.
//
// It exists so the JSON error envelopes are defined exactly once. The shapes
// below are a live contract with the frontend: frontend/src/api/templates.ts
// parses them by hand (isValidationErrorBody, the 403 branch, ApiError), so the
// field names, their order, and the "validation_error" code string are not free
// to drift. They were lifted verbatim out of templates/handler.go, where they
// started, when reports and dashboard needed the same envelopes.
//
// Two shapes, and only two:
//
//	error:      {"code": "...", "message": "..."}
//	validation: {"code": "validation_error", "message": "...", "elementId": null|"..."}
package httpx

import (
	"encoding/json"
	"log"
	"net/http"
)

// ValidationCode is the stable machine-readable code on every validation
// failure body. The frontend matches on this exact string.
const ValidationCode = "validation_error"

// ErrorBody is the generic JSON error envelope, used for decode (400),
// authorization (403), not-found (404), not-implemented (501) and internal
// (500) responses.
type ErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

// ValidationErrorBody is the JSON body returned on a 422 validation failure. It
// mirrors the frontend ValidationError type: a stable code, a human-readable
// message, and the offending element id — null when the failure is structural
// and names no element, which is why ElementID is a pointer rather than a
// string with omitempty (the key must always be present).
type ValidationErrorBody struct {
	Code      string  `json:"code"`
	Message   string  `json:"message"`
	ElementID *string `json:"elementId"`
}

// WriteJSON encodes body as JSON with the given status code. If encoding fails
// after the status line has been written there is nothing further to do but log
// it server-side — the response is already committed.
func WriteJSON(w http.ResponseWriter, status int, body any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(body); err != nil {
		log.Printf("httpx: encode response: %v", err)
	}
}

// WriteError writes the generic error envelope with the given status, code, and
// message. The message is shown to the user, so it must never carry internal
// detail: log the underlying error and send something generic.
func WriteError(w http.ResponseWriter, status int, code, message string) {
	WriteJSON(w, status, ErrorBody{Code: code, Message: message})
}

// WriteValidationError writes a 422 response with the validation error body,
// naming the offending element (pass nil when the failure is structural).
func WriteValidationError(w http.ResponseWriter, message string, elementID *string) {
	WriteJSON(w, http.StatusUnprocessableEntity, ValidationErrorBody{
		Code:      ValidationCode,
		Message:   message,
		ElementID: elementID,
	})
}

// WriteNotImplemented writes a 501 in the generic error envelope. It is what a
// route that is registered but not yet built answers with, so the frontend gets
// a parseable body and a clear status instead of a 404 that looks like a typo
// in the URL.
func WriteNotImplemented(w http.ResponseWriter, message string) {
	WriteError(w, http.StatusNotImplemented, "not_implemented", message)
}
