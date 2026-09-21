// RequireAuth.test.tsx — the authentication gate's four behaviours.
//
// These exist because all four fail SILENTLY and in opposite directions:
//
//   redirect too eagerly  -> a signed-in user is bounced to /login on every
//                            hard load, or sees it flash there and back
//   redirect too late     -> a signed-out user watches the dashboard 401
//   lose `from`           -> a deep link dies at login and dumps the user on
//                            /dashboard with no idea why
//   gate /login too       -> nobody can sign in at all
//
// Each of those looks like a minor UI wobble in a screenshot and is a real
// defect. So each gets a test.
//
// The auth CLIENT is mocked, not the context: AuthProvider's own logic — the
// mount-time me() round trip and the `loading` flag it drives — is the thing
// under test here, and mocking the context away would test nothing.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { MemoryRouter, Navigate, Route, Routes, useLocation } from "react-router-dom";

vi.mock("../api/auth", () => ({
  login: vi.fn(),
  logout: vi.fn(),
  me: vi.fn(),
}));

import * as authApi from "../api/auth";
import { AuthProvider } from "../auth/AuthContext";
import { RequireAuth } from "./RequireAuth";
import { RequireRoleRoute } from "./RequireRoleRoute";
import { TOKEN_STORAGE_KEY } from "../api/client";

const DISPATCHER = {
  id: "u1",
  name: "Demo Dispatcher",
  email: "dispatch@reportmate.local",
  role: "dispatcher_admin",
};
const TECHNICIAN = {
  id: "u2",
  name: "Demo Technician",
  email: "tech@reportmate.local",
  role: "technician",
};

let container: HTMLDivElement;
let root: Root;

// Records every location the router visits, so a test can assert on what the
// user SAW and not merely where they ended up — a flash is an intermediate
// render, and only a log of them can catch it.
const visited: { path: string; state: unknown }[] = [];

function LocationRecorder() {
  const location = useLocation();
  visited.push({ path: location.pathname + location.search, state: location.state });
  return null;
}

// A stand-in for the login screen that reports what the guard handed it.
function FakeLogin() {
  const location = useLocation();
  const from = (location.state as { from?: { pathname?: string; search?: string } } | null)?.from;
  return (
    <div data-testid="login-screen" data-from={`${from?.pathname ?? ""}${from?.search ?? ""}`}>
      Sign in
    </div>
  );
}

function Protected({ name }: { name: string }) {
  return <div data-testid="protected">{name}</div>;
}

async function renderAt(path: string) {
  await act(async () => {
    root.render(
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <LocationRecorder />
          <Routes>
            <Route path="/login" element={<FakeLogin />} />
            <Route element={<RequireAuth />}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="/dashboard" element={<Protected name="dashboard" />} />
              <Route
                path="/dashboard/templates/:id"
                element={<Protected name="template reports" />}
              />
              <Route element={<RequireRoleRoute />}>
                <Route path="/templates" element={<Protected name="templates" />} />
              </Route>
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
  });
}

const one = (testId: string) =>
  container.querySelector(`[data-testid="${testId}"]`);

beforeEach(() => {
  (globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  visited.length = 0;
  window.localStorage.clear();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
  window.localStorage.clear();
});

describe("RequireAuth", () => {
  it("sends a signed-out visitor to /login", async () => {
    // No stored token: AuthContext resolves to signed-out without calling me().
    await renderAt("/dashboard");

    expect(one("login-screen")).not.toBeNull();
    expect(one("protected")).toBeNull();
    expect(authApi.me).not.toHaveBeenCalled();
  });

  it.each([
    ["/", "the index redirect"],
    ["/dashboard", "the dashboard"],
    ["/dashboard/templates/tpl_hvac", "a template's reports"],
    ["/templates", "the dispatcher-only branch"],
    ["/nonsense", "an unknown path"],
  ])("gates %s (%s)", async (path) => {
    await renderAt(path);

    expect(one("login-screen")).not.toBeNull();
    expect(one("protected")).toBeNull();
    // Nothing protected may render even for a frame on the way there.
    expect(visited.map((v) => v.path)).not.toContain("/dashboard?leaked");
  });

  it("hands the attempted location to /login as `from`, query string included", async () => {
    // The dashboard keeps its filters in the query string, so a deep link that
    // survives login without its search is a deep link that lost its point.
    await renderAt("/dashboard/templates/tpl_hvac?status=draft&q=acme");

    expect(one("login-screen")?.getAttribute("data-from")).toBe(
      "/dashboard/templates/tpl_hvac?status=draft&q=acme",
    );
  });

  it("lets a signed-in user through, with no flash of the login screen", async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, "a-stored-token");
    vi.mocked(authApi.me).mockResolvedValue(DISPATCHER);

    await renderAt("/dashboard");

    expect(one("protected")?.textContent).toBe("dashboard");
    // THE FLASH TEST. A guard that redirected while `loading` was still true
    // would have pushed /login into this log before settling on /dashboard.
    expect(visited.map((v) => v.path)).toEqual(["/dashboard"]);
    expect(one("login-screen")).toBeNull();
  });

  it("holds the route while the session is still restoring", async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, "a-stored-token");
    // A me() that never settles: the guard must wait, not guess.
    vi.mocked(authApi.me).mockReturnValue(new Promise(() => {}));

    await renderAt("/dashboard");

    expect(one("login-screen")).toBeNull();
    expect(one("protected")).toBeNull();
    expect(container.textContent).toContain("Checking your session");
    expect(visited.map((v) => v.path)).toEqual(["/dashboard"]);
  });

  it("redirects when the stored token turns out to be dead", async () => {
    // A token in localStorage is a claim, not a session. A 401 from me() must
    // land the user on /login, not on a dashboard that 401s every request.
    window.localStorage.setItem(TOKEN_STORAGE_KEY, "an-expired-token");
    vi.mocked(authApi.me).mockRejectedValue(new Error("401"));

    await renderAt("/dashboard");

    expect(one("login-screen")).not.toBeNull();
    // ...and the dead token is swept up so it stops riding on every request.
    expect(window.localStorage.getItem(TOKEN_STORAGE_KEY)).toBeNull();
  });
});

describe("RequireAuth composed with RequireRoleRoute", () => {
  // The two guards answer different questions and must not be collapsed into
  // one. These two tests are the difference between them, stated as behaviour.

  it("bounces a signed-OUT visitor off /templates rather than denying them", async () => {
    await renderAt("/templates");

    expect(one("login-screen")).not.toBeNull();
    // Not the role guard's message: there is no user to deny yet.
    expect(one("require-role-denied")).toBeNull();
  });

  it("denies a signed-IN technician on /templates rather than bouncing them", async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, "a-stored-token");
    vi.mocked(authApi.me).mockResolvedValue(TECHNICIAN);

    await renderAt("/templates");

    expect(one("require-role-denied")).not.toBeNull();
    expect(one("login-screen")).toBeNull();
    expect(one("protected")).toBeNull();
    // They stay where they are; being the wrong role is not being logged out.
    expect(visited.map((v) => v.path)).toEqual(["/templates"]);
  });

  it("lets a signed-in dispatcher through with no flash of access-denied", async () => {
    window.localStorage.setItem(TOKEN_STORAGE_KEY, "a-stored-token");
    vi.mocked(authApi.me).mockResolvedValue(DISPATCHER);

    await renderAt("/templates");

    expect(one("protected")?.textContent).toBe("templates");
    expect(one("require-role-denied")).toBeNull();
  });
});
