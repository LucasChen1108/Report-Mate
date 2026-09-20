import { matchPath } from "react-router-dom";
import type { UserRole } from "../auth/contracts";
import { USER_ROLES } from "../auth/contracts";
import { ROUTES } from "../config/routes";

export interface AuthRedirectLocation {
  pathname: string;
  search: string;
  hash: string;
}

export interface AuthRedirectState {
  from: AuthRedirectLocation;
}

export function getRoleLandingRoute(role: UserRole): string {
  return role === USER_ROLES.admin
    ? ROUTES.templates
    : ROUTES.generateReport;
}

export function getPostLoginRoute(
  state: unknown,
  role: UserRole,
): string {
  const intendedLocation = readAuthRedirectLocation(state);
  if (
    !intendedLocation ||
    !isRouteAllowedForRole(intendedLocation.pathname, role)
  ) {
    return getRoleLandingRoute(role);
  }

  return `${intendedLocation.pathname}${intendedLocation.search}${intendedLocation.hash}`;
}

export function isRouteAllowedForRole(
  pathname: string,
  role: UserRole,
): boolean {
  if (pathname === ROUTES.generateReport) return true;

  if (role === USER_ROLES.worker) {
    return pathname === ROUTES.profile;
  }

  return (
    pathname === ROUTES.templates ||
    pathname === ROUTES.newTemplate ||
    pathname === ROUTES.workers ||
    matchPath({ path: ROUTES.templateDetail, end: true }, pathname) !== null
  );
}

function readAuthRedirectLocation(state: unknown): AuthRedirectLocation | null {
  if (typeof state !== "object" || state === null || !("from" in state)) {
    return null;
  }

  const from = (state as { from?: unknown }).from;
  if (typeof from !== "object" || from === null) return null;

  const candidate = from as Partial<AuthRedirectLocation>;
  if (
    !isSafeInternalPathname(candidate.pathname) ||
    !isSafeSearch(candidate.search) ||
    !isSafeHash(candidate.hash)
  ) {
    return null;
  }

  return {
    pathname: candidate.pathname,
    search: candidate.search,
    hash: candidate.hash,
  };
}

function isSafeInternalPathname(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !value.includes("\\")
  );
}

function isSafeSearch(value: unknown): value is string {
  return typeof value === "string" && (value === "" || value.startsWith("?"));
}

function isSafeHash(value: unknown): value is string {
  return typeof value === "string" && (value === "" || value.startsWith("#"));
}
