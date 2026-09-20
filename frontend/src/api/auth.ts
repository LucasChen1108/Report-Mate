// auth.ts — the client for the backend's /api/auth routes.
//
// Every call goes through `request` from ./client.ts, which is the single place
// `fetch` is called in this app (src/api/README.md). That matters here more
// than anywhere else: client.ts already reads the stored token and attaches the
// `Authorization: Bearer` header, so this module never touches the header and
// never touches localStorage. Writing the token is AuthContext's job; reading
// it back onto a request is client.ts's. This file just describes the shapes.

import { request } from "./client";

// The signed-in account, exactly as the backend's auth.User encodes it. It is
// structurally identical to AuthUser in auth/AuthContext.tsx, which is the type
// the rest of the app consumes — this one is the wire shape, kept separate so a
// backend field addition does not silently widen the app-facing type.
export interface AuthUserPayload {
  id: string;
  name: string;
  email: string;
  role: string;
}

// The body of a successful POST /api/auth/login.
export interface LoginResponse {
  token: string;
  user: AuthUserPayload;
}

// Exchange credentials for a bearer token.
//
// A wrong password and an unknown email both come back as an identical 401
// (the backend does that deliberately, so an attacker cannot enumerate
// accounts), which `request` surfaces as an ApiError with status 401. Callers
// must not try to tell the two apart — there is nothing there to tell apart.
export function login(email: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>("POST", "/api/auth/login", { email, password });
}

// Fetch the account behind the currently stored token. Rejects with an ApiError
// of status 401 when there is no token or the token is no longer valid, which
// is how AuthContext decides whether a restored session is still good.
export function me(): Promise<AuthUserPayload> {
  return request<AuthUserPayload>("GET", "/api/auth/me");
}

// Tell the backend the session is over.
//
// The tokens are stateless and there is no server-side deny list, so this is
// symmetry rather than security: the actual sign-out is AuthContext dropping
// the token from localStorage. Call it, but never block sign-out on it — a
// failed logout request must still sign the user out locally.
export function logout(): Promise<void> {
  return request<void>("POST", "/api/auth/logout");
}
