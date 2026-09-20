import type { MockUserRecord } from "./fixtures";
import { ServiceError } from "../errors";
import { MockDataStore } from "./MockDataStore";

export const MOCK_SESSION_STORAGE_KEY = "report-mate.mock-session";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export class MemoryStorage implements StorageLike {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

export class MockSessionManager {
  constructor(
    private readonly store: MockDataStore,
    private readonly storage: StorageLike,
  ) {}

  currentUser(): MockUserRecord | null {
    const storedValue = this.storage.getItem(MOCK_SESSION_STORAGE_KEY);
    if (!storedValue) return null;

    const persistedSession = this.parsePersistedSession(storedValue);
    const token = persistedSession?.token ?? storedValue;
    const session = persistedSession ?? this.store.findSession(token);
    if (
      !session ||
      new Date(session.expiresAt).getTime() <= this.store.clock().getTime()
    ) {
      if (session) this.store.deleteSession(token);
      this.storage.removeItem(MOCK_SESSION_STORAGE_KEY);
      throw new ServiceError({
        code: "session_expired",
        message: "Your session has expired. Please sign in again.",
        status: 401,
      });
    }

    const user = this.store.findUserById(session.userId);
    if (!user) {
      this.clear();
      throw new ServiceError({
        code: "unauthenticated",
        message: "Please sign in to continue.",
        status: 401,
      });
    }
    if (!user.isActive) {
      this.clear();
      throw new ServiceError({
        code: "inactive_account",
        message: "This account is inactive. Contact your administrator.",
        status: 403,
      });
    }
    return user;
  }

  requireCurrentUser(): MockUserRecord {
    const user = this.currentUser();
    if (!user) {
      throw new ServiceError({
        code: "unauthenticated",
        message: "Please sign in to continue.",
        status: 401,
      });
    }
    return user;
  }

  start(userId: string): void {
    const storedValue = this.storage.getItem(MOCK_SESSION_STORAGE_KEY);
    const currentToken = storedValue
      ? this.parsePersistedSession(storedValue)?.token ?? storedValue
      : null;
    if (currentToken) this.store.deleteSession(currentToken);
    const session = this.store.createSession(userId);
    // This contains only a disposable mock token, user id, and expiry. It lets
    // seeded demo accounts survive a real page refresh without storing a
    // password, authorization code, or production-like secret.
    this.storage.setItem(MOCK_SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  clear(): void {
    const storedValue = this.storage.getItem(MOCK_SESSION_STORAGE_KEY);
    const token = storedValue
      ? this.parsePersistedSession(storedValue)?.token ?? storedValue
      : null;
    if (token) this.store.deleteSession(token);
    this.storage.removeItem(MOCK_SESSION_STORAGE_KEY);
  }

  private parsePersistedSession(value: string): {
    token: string;
    userId: string;
    expiresAt: string;
  } | null {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      return typeof parsed.token === "string" &&
        typeof parsed.userId === "string" &&
        typeof parsed.expiresAt === "string"
        ? {
            token: parsed.token,
            userId: parsed.userId,
            expiresAt: parsed.expiresAt,
          }
        : null;
    } catch {
      return null;
    }
  }
}
