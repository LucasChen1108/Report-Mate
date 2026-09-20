// AuthContext — the app's single source of truth for who is signed in.
//
// It owns the session: the bearer token, the user behind it, and the three
// operations that change either (restore on mount, login, logout). Everything
// else reads it through useAuth().
//
// THE EXPORTED SURFACE IS FROZEN. AuthUser, AuthState, AuthProvider and
// useAuth are consumed by RequireRoleRoute, AppLayout and several pages that
// other people own. This file swapped a hardcoded dev user for real login
// without changing any of those four, which is the whole reason the shape was
// pinned down before the implementation existed.
//
// WHERE THE TOKEN LIVES. localStorage, under TOKEN_STORAGE_KEY from
// api/client.ts — the same constant the request helper reads it back from.
// This module WRITES that key and nothing else does; client.ts READS it and
// attaches the Authorization header. Neither duplicates the other's job, so
// the token has exactly one owner and one reader.
//
// WHAT IS NOT PERSISTED: the user. Only the token survives a refresh, and the
// user is re-fetched from GET /api/auth/me on every mount. Caching the user
// would render a stale name or — worse — a stale ROLE on the first frame, and
// a role is what the route guard keys off. One round trip on load is the
// cheaper mistake.
//
// AUTHORITY NOTE: like components/RequireRole, this is a UX layer. The backend
// auth + RBAC middleware is the authoritative check; a user who edits
// localStorage gets a nicer-looking UI and still a 401/403 from the server.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { ReactNode } from "react";
import { TOKEN_STORAGE_KEY } from "../api/client";
import * as authApi from "../api/auth";

// The signed-in user. `role` is a plain string (not a union) because the
// backend owns the role vocabulary; compare against DISPATCHER_ADMIN_ROLE from
// components/RequireRole rather than inlining the literal.
export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string;
}

export interface AuthState {
  user: AuthUser | null;
  token: string | null;
  login(email: string, password: string): Promise<void>;
  logout(): void;
  // True until the mount-time session restore has finished — which now means
  // "until GET /api/auth/me has answered", not just "until localStorage was
  // read". Consumers that redirect or deny on `user === null` MUST wait for
  // this to be false, or they will bounce a signed-in user on the first frame.
  loading: boolean;
}

// Left over from the pre-login build, which cached the user alongside the
// token. Nothing writes it any more; it is cleared on mount so a stale user
// from an older bundle cannot linger in a returning browser's storage.
const LEGACY_USER_STORAGE_KEY = "reportmate.user";

const AuthContext = createContext<AuthState | null>(null);

// localStorage throws in a few browser configurations (private mode, blocked
// site data). Every access below is wrapped: a storage failure must degrade to
// "signed out", never crash the app.

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string): void {
  try {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } catch {
    // The session still works for this tab; it just will not survive a
    // refresh. Better than failing the login the user just completed.
  }
}

function clearStoredToken(): void {
  try {
    window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    window.localStorage.removeItem(LEGACY_USER_STORAGE_KEY);
  } catch {
    // Ignore: a storage failure must not prevent clearing in-memory state.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Restore the session once on mount.
  //
  // A token in localStorage is a CLAIM, not a session: it may be expired, may
  // have been signed by a previous JWT_SIGNING_KEY, may belong to a deleted
  // account. So the token is never trusted on its own — me() asks the backend
  // to validate it, and anything other than a user in reply clears it. That
  // also keeps a dead token from being attached to every subsequent request.
  useEffect(() => {
    let cancelled = false;

    const storedToken = readStoredToken();
    if (!storedToken) {
      // Nothing to validate. Clear anyway to sweep up a legacy cached user.
      clearStoredToken();
      setLoading(false);
      return;
    }

    // Publish the token immediately so client.ts attaches it to the me() call
    // below — it reads localStorage, which already holds it, but keeping the
    // state in step avoids a render where `token` is null for a session that
    // turns out to be valid.
    setToken(storedToken);

    authApi
      .me()
      .then((restored) => {
        if (cancelled) return;
        setUser(restored);
      })
      .catch(() => {
        if (cancelled) return;
        // Rejected (401) or unreachable. Either way this token is not usable
        // right now, and holding it would send a bad Authorization header on
        // every request until the tab is closed.
        clearStoredToken();
        setToken(null);
        setUser(null);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    // React 18 StrictMode mounts effects twice in development; the flag stops
    // the unmounted first pass from writing state after the second has run.
    return () => {
      cancelled = true;
    };
  }, []);

  // Sign in. Errors are deliberately NOT swallowed — the Login page catches
  // them to show a message, and a login that resolved on failure would leave
  // the form thinking it had succeeded.
  const login = useCallback(async (email: string, password: string) => {
    const { token: issued, user: signedIn } = await authApi.login(
      email,
      password,
    );
    // Storage first: client.ts reads the token from localStorage, not from
    // this state, so it must be there before any request the re-render fires.
    writeStoredToken(issued);
    setToken(issued);
    setUser(signedIn);
  }, []);

  // Sign out. Synchronous from the caller's point of view (AuthState.logout
  // returns void) because the local clear is the part that matters: the token
  // is stateless and the backend has no deny list, so notifying it is
  // courtesy. The request is fired and its failure ignored — a network error
  // must never leave a user stuck signed in.
  const logout = useCallback(() => {
    void authApi.logout().catch(() => undefined);
    clearStoredToken();
    setUser(null);
    setToken(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ user, token, login, logout, loading }),
    [user, token, login, logout, loading],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

// Read the auth state. Throws when used outside <AuthProvider> — that is a
// wiring bug, and a null-returning hook would push the same crash downstream
// into a confusing "cannot read role of null".
export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (ctx === null) {
    throw new Error("useAuth() must be used inside <AuthProvider>.");
  }
  return ctx;
}
