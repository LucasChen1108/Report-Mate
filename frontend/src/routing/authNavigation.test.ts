import { describe, expect, it } from "vitest";
import { USER_ROLES } from "../auth/contracts";
import { ROUTES, routeBuilders } from "../config/routes";
import {
  getPostLoginRoute,
  getRoleLandingRoute,
  isRouteAllowedForRole,
} from "./authNavigation";

describe("authentication navigation policy", () => {
  it("maps each role to its landing route", () => {
    expect(getRoleLandingRoute(USER_ROLES.admin)).toBe(ROUTES.templates);
    expect(getRoleLandingRoute(USER_ROLES.worker)).toBe(ROUTES.generateReport);
  });

  it.each([
    [ROUTES.generateReport, USER_ROLES.admin, true],
    [ROUTES.generateReport, USER_ROLES.worker, true],
    [ROUTES.dashboard, USER_ROLES.admin, true],
    [ROUTES.dashboard, USER_ROLES.worker, true],
    [routeBuilders.dashboardTemplate("template 1"), USER_ROLES.worker, true],
    [ROUTES.newReport, USER_ROLES.admin, true],
    [routeBuilders.report("report 1"), USER_ROLES.worker, true],
    [ROUTES.templates, USER_ROLES.admin, true],
    [ROUTES.newTemplate, USER_ROLES.admin, true],
    [routeBuilders.template("template 1"), USER_ROLES.admin, true],
    [ROUTES.workers, USER_ROLES.admin, true],
    [ROUTES.profile, USER_ROLES.worker, true],
    [ROUTES.templates, USER_ROLES.worker, false],
    [ROUTES.workers, USER_ROLES.worker, false],
    [ROUTES.profile, USER_ROLES.admin, false],
    ["/unknown", USER_ROLES.admin, false],
  ])("checks whether %s is allowed for %s", (path, role, expected) => {
    expect(isRouteAllowedForRole(path, role)).toBe(expected);
  });

  it("restores an allowed internal destination including search and hash", () => {
    expect(getPostLoginRoute({
      from: {
        pathname: routeBuilders.template("template-1"),
        search: "?mode=review",
        hash: "#fields",
      },
    }, USER_ROLES.admin)).toBe(
      `${routeBuilders.template("template-1")}?mode=review#fields`,
    );
  });

  it.each([
    undefined,
    { from: "https://example.test" },
    { from: { pathname: "https://example.test", search: "", hash: "" } },
    { from: { pathname: "//example.test", search: "", hash: "" } },
    { from: { pathname: ROUTES.templates, search: "bad", hash: "" } },
    { from: { pathname: ROUTES.templates, search: "", hash: "bad" } },
    { from: { pathname: "/unknown", search: "", hash: "" } },
  ])("rejects an invalid or unsafe redirect state", (state) => {
    expect(getPostLoginRoute(state, USER_ROLES.admin)).toBe(ROUTES.templates);
  });

  it("does not restore a destination forbidden to the authenticated role", () => {
    expect(getPostLoginRoute({
      from: { pathname: ROUTES.templates, search: "", hash: "" },
    }, USER_ROLES.worker)).toBe(ROUTES.generateReport);
  });
});
