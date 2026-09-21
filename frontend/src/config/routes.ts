export const ROUTES = {
  root: "/",
  login: "/login",
  register: "/register",
  dashboard: "/dashboard",
  dashboardTemplate: "/dashboard/templates/:templateId",
  generateReport: "/generate-report",
  newReport: "/reports/new",
  reportDetail: "/reports/:reportId",
  templates: "/templates",
  newTemplate: "/templates/new",
  templateDetail: "/templates/:id",
  workers: "/workers",
  profile: "/profile",
} as const;

export const routeBuilders = {
  dashboardTemplate: (id: string): string =>
    `/dashboard/templates/${encodeURIComponent(id)}`,
  newReport: (templateId: string): string =>
    `/reports/new?templateId=${encodeURIComponent(templateId)}`,
  report: (id: string): string => `/reports/${encodeURIComponent(id)}`,
  template: (id: string): string =>
    `/templates/${encodeURIComponent(id)}`,
} as const;
