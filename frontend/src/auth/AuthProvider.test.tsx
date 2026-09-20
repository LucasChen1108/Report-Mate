import { StrictMode } from "react";
import type { PropsWithChildren } from "react";
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthProvider";
import { USER_ROLES } from "./contracts";
import type {
  AuthUser,
  LoginInput,
  RegistrationInput,
  ServiceErrorCode,
} from "./contracts";
import type { AuthService, ServiceBundle } from "../services/contracts";
import { createMockServiceBundle } from "../services/createServices";
import { ServiceError } from "../services/errors";
import { ServiceProvider } from "../services/ServiceProvider";
import { MemoryStorage } from "../services/mock/MockSessionManager";

const adminUser: AuthUser = {
  id: "admin-1",
  fullName: "Admin User",
  companyId: "company-1",
  companyName: "Example Company",
  phone: "+65 8000 0001",
  personalEmail: "admin.personal@example.test",
  companyEmail: "admin@example.test",
  role: USER_ROLES.admin,
  isActive: true,
};

const workerUser: AuthUser = {
  ...adminUser,
  id: "worker-1",
  fullName: "Worker User",
  personalEmail: "worker.personal@example.test",
  companyEmail: "worker@example.test",
  role: USER_ROLES.worker,
};

const loginInput: LoginInput = {
  email: adminUser.companyEmail,
  password: "test-password",
};

const registrationInput: RegistrationInput = {
  role: USER_ROLES.worker,
  fullName: workerUser.fullName,
  company: workerUser.companyName,
  phone: workerUser.phone,
  personalEmail: workerUser.personalEmail,
  companyEmail: workerUser.companyEmail,
  password: "test-password",
  joinCode: "TEST-JOIN-CODE",
};

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function createAuthService(overrides: Partial<AuthService> = {}): AuthService {
  return {
    login: vi.fn(async () => adminUser),
    register: vi.fn(async () => workerUser),
    getCurrentUser: vi.fn(async () => null),
    logout: vi.fn(async () => undefined),
    ...overrides,
  };
}

function createWrapper(auth: AuthService, strict = false) {
  const services: ServiceBundle = {
    ...createMockServiceBundle({ storage: new MemoryStorage() }),
    auth,
  };

  return function Wrapper({ children }: PropsWithChildren) {
    const tree = (
      <ServiceProvider services={services}>
        <AuthProvider>{children}</AuthProvider>
      </ServiceProvider>
    );
    return strict ? <StrictMode>{tree}</StrictMode> : tree;
  };
}

async function waitForRestoration(
  result: ReturnType<typeof renderHook<ReturnType<typeof useAuth>, unknown>>["result"],
) {
  await waitFor(() => expect(result.current.isRestoring).toBe(false));
}

describe("AuthProvider", () => {
  it("restores the current user and exposes an explicit loading state", async () => {
    const restoration = deferred<AuthUser | null>();
    const auth = createAuthService({
      getCurrentUser: vi.fn(() => restoration.promise),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });

    expect(result.current.isRestoring).toBe(true);
    expect(result.current.user).toBeNull();

    act(() => restoration.resolve(adminUser));
    await waitForRestoration(result);

    expect(result.current.user).toEqual(adminUser);
  });

  it("settles as unauthenticated when there is no stored session", async () => {
    const auth = createAuthService();
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });

    await waitForRestoration(result);

    expect(result.current.user).toBeNull();
    expect(auth.getCurrentUser).toHaveBeenCalledOnce();
  });

  it.each<ServiceErrorCode>(["session_expired", "inactive_account"])(
    "clears a terminal %s restoration failure",
    async (code) => {
      const auth = createAuthService({
        getCurrentUser: vi.fn(async () => {
          throw new ServiceError({ code, message: "Session is unavailable." });
        }),
      });
      const { result } = renderHook(() => useAuth(), {
        wrapper: createWrapper(auth),
      });

      await waitForRestoration(result);

      expect(result.current.user).toBeNull();
      expect(auth.logout).toHaveBeenCalledOnce();
    },
  );

  it("updates the current user after login", async () => {
    const auth = createAuthService();
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });
    await waitForRestoration(result);

    let returnedUser: AuthUser | undefined;
    await act(async () => {
      returnedUser = await result.current.login(loginInput);
    });

    expect(returnedUser).toEqual(adminUser);
    expect(result.current.user).toEqual(adminUser);
    expect(auth.login).toHaveBeenCalledWith(loginInput);
  });

  it("updates the current user after registration", async () => {
    const auth = createAuthService();
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });
    await waitForRestoration(result);

    await act(async () => {
      await result.current.register(registrationInput);
    });

    expect(result.current.user).toEqual(workerUser);
    expect(auth.register).toHaveBeenCalledWith(registrationInput);
  });

  it("propagates a failed login without replacing the restored user", async () => {
    const loginError = new ServiceError({
      code: "invalid_credentials",
      message: "Email or password is incorrect.",
    });
    const auth = createAuthService({
      getCurrentUser: vi.fn(async () => adminUser),
      login: vi.fn(async () => {
        throw loginError;
      }),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });
    await waitForRestoration(result);

    let caughtError: unknown;
    await act(async () => {
      try {
        await result.current.login(loginInput);
      } catch (error) {
        caughtError = error;
      }
    });

    expect(caughtError).toBe(loginError);
    expect(result.current.user).toEqual(adminUser);
  });

  it("clears the current user when logging out", async () => {
    const auth = createAuthService({
      getCurrentUser: vi.fn(async () => adminUser),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });
    await waitForRestoration(result);

    await act(async () => {
      await result.current.logout();
    });

    expect(result.current.user).toBeNull();
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it("centrally handles later session errors and ignores unrelated errors", async () => {
    const auth = createAuthService({
      getCurrentUser: vi.fn(async () => adminUser),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });
    await waitForRestoration(result);

    let handled = true;
    await act(async () => {
      handled = await result.current.handleSessionError(new Error("Other"));
    });
    expect(handled).toBe(false);
    expect(result.current.user).toEqual(adminUser);

    await act(async () => {
      handled = await result.current.handleSessionError(
        new ServiceError({
          code: "session_expired",
          message: "Session expired.",
        }),
      );
    });

    expect(handled).toBe(true);
    expect(result.current.user).toBeNull();
    expect(auth.logout).toHaveBeenCalledOnce();
  });

  it("merges profile identity fields only for the current authenticated user", async () => {
    const auth = createAuthService({
      getCurrentUser: vi.fn(async () => workerUser),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });
    await waitForRestoration(result);

    act(() => {
      result.current.updateUserIdentity({
        id: workerUser.id,
        fullName: "Updated Worker",
        phone: "+65 8999 0000",
        personalEmail: "updated.worker@example.test",
      });
    });

    expect(result.current.user).toEqual({
      ...workerUser,
      fullName: "Updated Worker",
      phone: "+65 8999 0000",
      personalEmail: "updated.worker@example.test",
    });

    act(() => {
      result.current.updateUserIdentity({
        id: "another-user",
        fullName: "Wrong User",
        phone: "+65 8111 1111",
        personalEmail: "wrong@example.test",
      });
    });
    expect(result.current.user?.fullName).toBe("Updated Worker");
  });

  it("does not let a stale restoration overwrite a newer login", async () => {
    const restoration = deferred<AuthUser | null>();
    const auth = createAuthService({
      getCurrentUser: vi.fn(() => restoration.promise),
      login: vi.fn(async () => workerUser),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });

    await act(async () => {
      await result.current.login(loginInput);
    });
    expect(result.current.user).toEqual(workerUser);

    act(() => restoration.resolve(adminUser));
    await act(async () => restoration.promise);

    expect(result.current.user).toEqual(workerUser);
    expect(result.current.isRestoring).toBe(false);
  });

  it("does not let a stale login overwrite a later logout", async () => {
    const pendingLogin = deferred<AuthUser>();
    const auth = createAuthService({
      login: vi.fn(() => pendingLogin.promise),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth),
    });
    await waitForRestoration(result);

    let loginPromise!: Promise<AuthUser>;
    act(() => {
      loginPromise = result.current.login(loginInput);
    });
    await act(async () => {
      await result.current.logout();
    });

    act(() => pendingLogin.resolve(adminUser));
    await act(async () => loginPromise);

    expect(result.current.user).toBeNull();
  });

  it("performs only one restoration during Strict Mode effect replay", async () => {
    const restoration = deferred<AuthUser | null>();
    const auth = createAuthService({
      getCurrentUser: vi.fn(() => restoration.promise),
    });
    const { result } = renderHook(() => useAuth(), {
      wrapper: createWrapper(auth, true),
    });

    expect(auth.getCurrentUser).toHaveBeenCalledOnce();
    act(() => restoration.resolve(adminUser));
    await waitForRestoration(result);

    expect(result.current.user).toEqual(adminUser);
    expect(auth.getCurrentUser).toHaveBeenCalledOnce();
  });

  it("throws a clear error when useAuth is used outside the provider", () => {
    expect(() => renderHook(() => useAuth())).toThrow(
      "useAuth must be used within an AuthProvider",
    );
  });
});
