function encodePathSegment(value: string): string {
  return encodeURIComponent(value);
}

export const API_ENDPOINTS = {
  login: "/auth/login",
  register: "/auth/register",
  logout: "/auth/logout",
  currentUser: "/auth/me",
  profile: "/api/me",
  workers: "/api/admin/workers",
  joinCodes: "/api/admin/join-codes",
  templates: "/api/templates",
} as const;

export const endpointBuilders = {
  worker: (id: string): string =>
    `${API_ENDPOINTS.workers}/${encodePathSegment(id)}`,
  joinCode: (id: string): string =>
    `${API_ENDPOINTS.joinCodes}/${encodePathSegment(id)}`,
  template: (id: string): string =>
    `${API_ENDPOINTS.templates}/${encodePathSegment(id)}`,
} as const;
