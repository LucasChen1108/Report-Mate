import { request } from "../../api/client";

export function apiRequest<T>(
  baseUrl: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  return request<T>(method, path, body, { baseUrl });
}
