import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ApiAuthorizationError,
  ApiError,
  ApiValidationError,
  SESSION_INVALID_EVENT,
  request,
  requestRaw,
} from "./client";

let fetchMock: ReturnType<typeof vi.fn>;

function response(status: number, body?: unknown): Response {
  const text = body === undefined
    ? ""
    : typeof body === "string"
      ? body
      : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: () => Promise.resolve(text),
  } as Response;
}

beforeEach(() => {
  fetchMock = vi.fn().mockResolvedValue(response(200, { ok: true }));
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("shared API transport", () => {
  it("uses cookie credentials for JSON and never adds an authorization header", async () => {
    await request("POST", "/api/example", { value: 1 }, {
      baseUrl: "https://api.example.test",
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/example",
      expect.objectContaining({ method: "POST", credentials: "include" }),
    );
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(new Headers(init.headers).get("Content-Type")).toBe("application/json");
    expect(new Headers(init.headers).has("Authorization")).toBe(false);
  });

  it("passes FormData through without forcing a content type", async () => {
    const form = new FormData();
    form.set("photo", new Blob(["image"]), "photo.txt");

    await requestRaw("POST", "/api/upload", form);

    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(form);
    expect(new Headers(init.headers).has("Content-Type")).toBe(false);
    expect(init.credentials).toBe("include");
  });

  it.each([
    [400, "validation_error"],
    [401, "unauthenticated"],
    [404, "not_found"],
    [409, "conflict"],
    [429, "rate_limited"],
  ] as const)("maps status %i into %s", async (status, code) => {
    fetchMock.mockResolvedValue(response(status, { message: "Safe message" }));

    await request("GET", "/api/failure").catch((error: unknown) => {
      expect(error).toBeInstanceOf(ApiError);
      expect(error).toMatchObject({ code, status, message: "Safe message" });
    });
    expect.assertions(2);
  });

  it("preserves template validation details", async () => {
    fetchMock.mockResolvedValue(response(422, {
      code: "validation_error",
      message: "A field is invalid.",
      elementId: "field-1",
    }));

    await request("POST", "/api/templates", {}).catch((error: unknown) => {
      expect(error).toBeInstanceOf(ApiValidationError);
      expect(error).toMatchObject({ elementId: "field-1" });
    });
    expect.assertions(2);
  });

  it("keeps forbidden responses distinct", async () => {
    fetchMock.mockResolvedValue(response(403, {
      code: "forbidden",
      message: "No access.",
    }));

    await expect(request("GET", "/api/admin/workers")).rejects.toBeInstanceOf(
      ApiAuthorizationError,
    );
  });

  it("announces an invalid session so AuthProvider can clear every API surface", async () => {
    const listener = vi.fn();
    window.addEventListener(SESSION_INVALID_EVENT, listener);
    fetchMock.mockResolvedValue(response(401, {
      code: "session_expired",
      message: "Sign in again.",
    }));

    await expect(request("GET", "/api/reports")).rejects.toMatchObject({
      code: "session_expired",
    });
    expect(listener).toHaveBeenCalledOnce();
    window.removeEventListener(SESSION_INVALID_EVENT, listener);
  });
});
