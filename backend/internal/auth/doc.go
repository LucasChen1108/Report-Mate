// Package auth authenticates requests and issues the tokens that carry an
// identity between the browser and the API.
//
// It occupies the seam the (now deleted) middleware.DevIdentity shim held open:
// Middleware reads a bearer token off the request, validates it, and populates
// BOTH middleware.WithUserID and middleware.WithRole into the request context.
// Every downstream handler already reads identity through those two accessors,
// so nothing outside this package had to change when real auth landed.
//
// The pieces:
//
//	password.go   bcrypt hashing and verification (never log a password/hash)
//	jwt.go        HS256 issue/parse, signed with JWT_SIGNING_KEY
//	store.go      user lookup by email (CITEXT) and by id
//	middleware.go the request-context identity middleware
//	handler.go    POST /api/auth/login, GET /api/auth/me, POST /api/auth/logout
//	install.go    Install: one call that wires all of the above into cmd/server
//
// AUTHENTICATE, DON'T AUTHORIZE. Middleware never rejects a request. A request
// with no token, an expired token, a tampered token or an "alg: none" token
// simply proceeds WITHOUT an identity, and the existing per-route rules decide
// what that means: middleware.RequireRole answers 403 when no role is present,
// and the handlers that need a user id answer 401 when none is. Keeping the
// rejection decision with the routes is what lets /api/auth/login stay reachable
// without a token while everything else stays gated.
//
// ENUMERATION. A wrong password and an unknown email produce a byte-identical
// response, and the login path runs a bcrypt comparison even when no user was
// found, so neither the body nor the response time distinguishes the two.
package auth
