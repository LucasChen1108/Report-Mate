import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type { AuthUser, LoginInput, RegistrationInput } from "./contracts";
import { isServiceError } from "../services/errors";
import type { AuthService } from "../services/contracts";
import { useServices } from "../services/ServiceProvider";

interface AuthContextValue {
  user: AuthUser | null;
  isRestoring: boolean;
  login: (input: LoginInput) => Promise<AuthUser>;
  register: (input: RegistrationInput) => Promise<AuthUser>;
  logout: () => Promise<void>;
  handleSessionError: (error: unknown) => Promise<boolean>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function isSessionError(error: unknown): boolean {
  return isServiceError(error) && (
    error.code === "session_expired" ||
    error.code === "unauthenticated" ||
    error.code === "inactive_account"
  );
}

async function clearServiceSession(auth: AuthService): Promise<void> {
  try {
    await auth.logout();
  } catch {
    // Frontend authentication state must still be cleared if an already
    // invalid server session cannot be logged out again.
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const { auth } = useServices();
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const mountedRef = useRef(false);
  const operationRef = useRef(0);
  const restorationAuthRef = useRef<AuthService | null>(null);
  const restorationPromiseRef = useRef<Promise<AuthUser | null> | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    const operation = ++operationRef.current;

    if (
      restorationAuthRef.current !== auth ||
      restorationPromiseRef.current === null
    ) {
      restorationAuthRef.current = auth;
      restorationPromiseRef.current = (async () => {
        try {
          return await auth.getCurrentUser();
        } catch (error) {
          if (isSessionError(error)) {
            await clearServiceSession(auth);
            return null;
          }
          throw error;
        }
      })();
    }

    void restorationPromiseRef.current.then(
      (restoredUser) => {
        if (mountedRef.current && operation === operationRef.current) {
          setUser(restoredUser);
          setIsRestoring(false);
        }
      },
      () => {
        if (mountedRef.current && operation === operationRef.current) {
          setUser(null);
          setIsRestoring(false);
        }
      },
    );

    return () => {
      mountedRef.current = false;
      if (operation === operationRef.current) {
        operationRef.current += 1;
      }
    };
  }, [auth]);

  const runUserAction = useCallback(
    async (action: () => Promise<AuthUser>): Promise<AuthUser> => {
      const operation = ++operationRef.current;
      try {
        const nextUser = await action();
        if (mountedRef.current && operation === operationRef.current) {
          setUser(nextUser);
          setIsRestoring(false);
        }
        return nextUser;
      } catch (error) {
        if (
          mountedRef.current &&
          operation === operationRef.current &&
          isSessionError(error)
        ) {
          setUser(null);
          setIsRestoring(false);
          await clearServiceSession(auth);
        }
        throw error;
      }
    },
    [auth],
  );

  const login = useCallback(
    (input: LoginInput) => runUserAction(() => auth.login(input)),
    [auth, runUserAction],
  );

  const register = useCallback(
    (input: RegistrationInput) => runUserAction(() => auth.register(input)),
    [auth, runUserAction],
  );

  const logout = useCallback(async (): Promise<void> => {
    const operation = ++operationRef.current;
    if (mountedRef.current) {
      setUser(null);
      setIsRestoring(false);
    }

    try {
      await auth.logout();
    } finally {
      if (mountedRef.current && operation === operationRef.current) {
        setUser(null);
        setIsRestoring(false);
      }
    }
  }, [auth]);

  const handleSessionError = useCallback(
    async (error: unknown): Promise<boolean> => {
      if (!isSessionError(error)) return false;

      operationRef.current += 1;
      if (mountedRef.current) {
        setUser(null);
        setIsRestoring(false);
      }
      await clearServiceSession(auth);
      return true;
    },
    [auth],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isRestoring,
      login,
      register,
      logout,
      handleSessionError,
    }),
    [handleSessionError, isRestoring, login, logout, register, user],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
