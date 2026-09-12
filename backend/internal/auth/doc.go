// Package auth handles login, sessions, and role selection.
//
// Responsibilities (to implement):
//   - POST /auth/login: verify credentials against the users table (password
//     hash), issue a session token / JWT.
//   - Role selection at login or first use: technician vs dispatcher-admin.
//   - Token issuing/validation helpers consumed by the middleware package.
//   - Password hashing (never store plaintext).
//
// Roles feed the RBAC middleware, which restricts dispatcher-only routes
// (template management, dashboard). Auth issues and validates the identity;
// middleware enforces access on each request.
package auth
