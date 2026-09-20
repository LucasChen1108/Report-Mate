export const ROUTES = {
  login: "/login",
  register: "/register",
  generateReport: "/generate-report",
  templates: "/templates",
  newTemplate: "/templates/new",
  templateDetail: "/templates/:id",
  workers: "/workers",
  profile: "/profile",
} as const;

export const routeBuilders = {
  template: (id: string): string =>
    `/templates/${encodeURIComponent(id)}`,
} as const;
