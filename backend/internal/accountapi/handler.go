// Package accountapi exposes self-service profile and Admin-scoped Worker
// management endpoints over the canonical accounts repository.
package accountapi

import (
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/LucasChen1108/Report-Mate/backend/internal/accounts"
	"github.com/LucasChen1108/Report-Mate/backend/internal/httpx"
	"github.com/LucasChen1108/Report-Mate/backend/internal/middleware"
	"github.com/LucasChen1108/Report-Mate/backend/internal/security"
)

const (
	adminRole        = "dispatcher_admin"
	defaultCodeTTL   = 7 * 24 * time.Hour
	maximumCodeTTL   = 30 * 24 * time.Hour
	workerCodePrefix = "WORKER"
)

type Store interface {
	accounts.AccountRepository
	accounts.WorkerRepository
}

type authMiddleware func(http.Handler) http.Handler

type Handler struct {
	store       Store
	requireAuth authMiddleware
	now         func() time.Time
	newID       func() (string, error)
	newCode     func(string) (string, error)
}

func NewHandler(store Store, requireAuth authMiddleware) *Handler {
	return &Handler{
		store: store, requireAuth: requireAuth, now: time.Now,
		newID: security.NewUUID, newCode: security.GenerateAuthorizationCode,
	}
}

func (h *Handler) RegisterRoutes(mux *http.ServeMux) {
	admin := func(handler http.HandlerFunc) http.Handler {
		return h.requireAuth(middleware.RequireRole(adminRole)(handler))
	}
	mux.Handle("GET /api/me", h.requireAuth(http.HandlerFunc(h.handleGetProfile)))
	mux.Handle("PATCH /api/me", h.requireAuth(http.HandlerFunc(h.handleUpdateProfile)))
	mux.Handle("GET /api/admin/workers", admin(h.handleListWorkers))
	mux.Handle("PATCH /api/admin/workers/{id}", admin(h.handleUpdateWorker))
	mux.Handle("GET /api/admin/join-codes", admin(h.handleListJoinCodes))
	mux.Handle("POST /api/admin/join-codes", admin(h.handleCreateJoinCode))
	mux.Handle("DELETE /api/admin/join-codes/{id}", admin(h.handleRevokeJoinCode))
}

type profileResponse struct {
	ID            string               `json:"id"`
	FullName      string               `json:"fullName"`
	CompanyID     string               `json:"companyId"`
	CompanyName   string               `json:"companyName"`
	Phone         string               `json:"phone"`
	PersonalEmail string               `json:"personalEmail"`
	CompanyEmail  string               `json:"companyEmail"`
	Role          accounts.Role        `json:"role"`
	IsActive      bool                 `json:"isActive"`
	LinkedAdmin   *linkedAdminResponse `json:"linkedAdmin"`
}

type linkedAdminResponse struct {
	ID           string `json:"id"`
	FullName     string `json:"fullName"`
	CompanyEmail string `json:"companyEmail"`
}

type workerSummaryResponse struct {
	ID           string `json:"id"`
	FullName     string `json:"fullName"`
	CompanyEmail string `json:"companyEmail"`
	Phone        string `json:"phone"`
	IsActive     bool   `json:"isActive"`
}

type workerDetailResponse struct {
	workerSummaryResponse
	PersonalEmail string              `json:"personalEmail"`
	CompanyID     string              `json:"companyId"`
	CompanyName   string              `json:"companyName"`
	Role          accounts.Role       `json:"role"`
	LinkedAdmin   linkedAdminResponse `json:"linkedAdmin"`
}

type joinCodeResponse struct {
	ID               string                  `json:"id"`
	CompanyID        string                  `json:"companyId"`
	CompanyName      string                  `json:"companyName"`
	CreatedByAdminID string                  `json:"createdByAdminId"`
	CreatedAt        time.Time               `json:"createdAt"`
	ExpiresAt        time.Time               `json:"expiresAt"`
	Status           accounts.JoinCodeStatus `json:"status"`
}

type generatedJoinCodeResponse struct {
	joinCodeResponse
	Code string `json:"code"`
}

func toProfile(account accounts.Account) profileResponse {
	response := profileResponse{
		ID: account.ID, FullName: account.FullName, CompanyID: account.CompanyID,
		CompanyName: account.CompanyName, Phone: account.Phone,
		PersonalEmail: account.PersonalEmail, CompanyEmail: account.CompanyEmail,
		Role: account.Role, IsActive: account.IsActive,
	}
	if account.LinkedAdmin != nil {
		response.LinkedAdmin = &linkedAdminResponse{
			ID: account.LinkedAdmin.ID, FullName: account.LinkedAdmin.FullName,
			CompanyEmail: account.LinkedAdmin.CompanyEmail,
		}
	}
	return response
}

func toWorkerSummary(account accounts.Account) workerSummaryResponse {
	return workerSummaryResponse{
		ID: account.ID, FullName: account.FullName, CompanyEmail: account.CompanyEmail,
		Phone: account.Phone, IsActive: account.IsActive,
	}
}

func toWorkerDetail(account accounts.Account) workerDetailResponse {
	detail := workerDetailResponse{
		workerSummaryResponse: toWorkerSummary(account), PersonalEmail: account.PersonalEmail,
		CompanyID: account.CompanyID, CompanyName: account.CompanyName, Role: account.Role,
	}
	if account.LinkedAdmin != nil {
		detail.LinkedAdmin = linkedAdminResponse{
			ID: account.LinkedAdmin.ID, FullName: account.LinkedAdmin.FullName,
			CompanyEmail: account.LinkedAdmin.CompanyEmail,
		}
	}
	return detail
}

func toJoinCode(code accounts.JoinCode) joinCodeResponse {
	return joinCodeResponse{
		ID: code.ID, CompanyID: code.CompanyID, CompanyName: code.CompanyName,
		CreatedByAdminID: code.CreatedByAdminID, CreatedAt: code.CreatedAt,
		ExpiresAt: code.ExpiresAt, Status: code.Status,
	}
}

func (h *Handler) handleGetProfile(w http.ResponseWriter, r *http.Request) {
	principal, ok := requestPrincipal(w, r)
	if !ok {
		return
	}
	account, err := h.store.FindByID(r.Context(), principal.UserID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toProfile(account))
}

type profileUpdateRequest struct {
	FullName      string `json:"fullName"`
	Phone         string `json:"phone"`
	PersonalEmail string `json:"personalEmail"`
}

func (h *Handler) handleUpdateProfile(w http.ResponseWriter, r *http.Request) {
	principal, ok := requestPrincipal(w, r)
	if !ok {
		return
	}
	var req profileUpdateRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	account, err := h.store.UpdateProfile(r.Context(), principal.UserID, accounts.ProfileUpdate{
		FullName: req.FullName, Phone: req.Phone, PersonalEmail: req.PersonalEmail,
	})
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toProfile(account))
}

func (h *Handler) handleListWorkers(w http.ResponseWriter, r *http.Request) {
	principal, ok := requestPrincipal(w, r)
	if !ok {
		return
	}
	workers, err := h.store.ListWorkers(r.Context(), principal.UserID)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	response := make([]workerSummaryResponse, 0, len(workers))
	for _, worker := range workers {
		response = append(response, toWorkerSummary(worker))
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

type workerStatusRequest struct {
	IsActive *bool `json:"isActive"`
}

func (h *Handler) handleUpdateWorker(w http.ResponseWriter, r *http.Request) {
	principal, ok := requestPrincipal(w, r)
	if !ok {
		return
	}
	var req workerStatusRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	if req.IsActive == nil {
		writeFieldError(w, http.StatusUnprocessableEntity, "validation_error", "isActive is required.", "isActive")
		return
	}
	worker, err := h.store.UpdateWorkerStatus(r.Context(), principal.UserID, r.PathValue("id"), *req.IsActive, h.now())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toWorkerDetail(worker))
}

type createJoinCodeRequest struct {
	ExpiresAt *time.Time `json:"expiresAt"`
}

func (h *Handler) handleCreateJoinCode(w http.ResponseWriter, r *http.Request) {
	principal, ok := requestPrincipal(w, r)
	if !ok {
		return
	}
	var req createJoinCodeRequest
	if !decodeJSON(w, r, &req) {
		return
	}
	now := h.now()
	expiresAt := now.Add(defaultCodeTTL)
	if req.ExpiresAt != nil {
		expiresAt = *req.ExpiresAt
	}
	if !expiresAt.After(now) || expiresAt.After(now.Add(maximumCodeTTL)) {
		writeFieldError(w, http.StatusUnprocessableEntity, "validation_error",
			"expiresAt must be in the future and no more than 30 days away.", "expiresAt")
		return
	}
	rawCode, err := h.newCode(workerCodePrefix)
	if err != nil {
		log.Printf("accountapi: generate Worker code: %v", err)
		writeInternalError(w)
		return
	}
	id, err := h.newID()
	if err != nil {
		log.Printf("accountapi: generate Worker code id: %v", err)
		writeInternalError(w)
		return
	}
	code, err := h.store.CreateWorkerJoinCode(r.Context(), principal.UserID, accounts.NewWorkerJoinCode{
		ID: id, CodeHash: security.HashSecret(rawCode), ExpiresAt: expiresAt,
	}, now)
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusCreated, generatedJoinCodeResponse{
		joinCodeResponse: toJoinCode(code), Code: rawCode,
	})
}

func (h *Handler) handleListJoinCodes(w http.ResponseWriter, r *http.Request) {
	principal, ok := requestPrincipal(w, r)
	if !ok {
		return
	}
	codes, err := h.store.ListWorkerJoinCodes(r.Context(), principal.UserID, h.now())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	response := make([]joinCodeResponse, 0, len(codes))
	for _, code := range codes {
		response = append(response, toJoinCode(code))
	}
	httpx.WriteJSON(w, http.StatusOK, response)
}

func (h *Handler) handleRevokeJoinCode(w http.ResponseWriter, r *http.Request) {
	principal, ok := requestPrincipal(w, r)
	if !ok {
		return
	}
	code, err := h.store.RevokeWorkerJoinCode(r.Context(), principal.UserID, r.PathValue("id"), h.now())
	if err != nil {
		writeStoreError(w, err)
		return
	}
	httpx.WriteJSON(w, http.StatusOK, toJoinCode(code))
}

func requestPrincipal(w http.ResponseWriter, r *http.Request) (middleware.Principal, bool) {
	principal, ok := middleware.PrincipalFromContext(r.Context())
	if !ok || principal.UserID == "" {
		httpx.WriteError(w, http.StatusUnauthorized, "unauthenticated", "You must be signed in to do that.")
		return middleware.Principal{}, false
	}
	return principal, true
}

func decodeJSON(w http.ResponseWriter, r *http.Request, destination any) bool {
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(destination); err != nil {
		httpx.WriteError(w, http.StatusBadRequest, "validation_error", "The request body is invalid.")
		return false
	}
	return true
}

type fieldErrorBody struct {
	Code    string `json:"code"`
	Message string `json:"message"`
	Field   string `json:"field,omitempty"`
}

func writeFieldError(w http.ResponseWriter, status int, code, message, field string) {
	httpx.WriteJSON(w, status, fieldErrorBody{Code: code, Message: message, Field: field})
}

func writeStoreError(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, accounts.ErrNotFound):
		httpx.WriteError(w, http.StatusNotFound, "not_found", "The requested resource was not found.")
	case errors.Is(err, accounts.ErrEmailConflict), errors.Is(err, accounts.ErrConflict):
		writeFieldError(w, http.StatusConflict, "conflict", "That email address is already in use.", "personalEmail")
	case errors.Is(err, accounts.ErrValidation):
		writeFieldError(w, http.StatusUnprocessableEntity, "validation_error", "Check the supplied values and try again.", "")
	default:
		log.Printf("accountapi: store operation failed: %v", err)
		writeInternalError(w)
	}
}

func writeInternalError(w http.ResponseWriter) {
	httpx.WriteError(w, http.StatusInternalServerError, "internal_error", "Something went wrong. Please try again.")
}
