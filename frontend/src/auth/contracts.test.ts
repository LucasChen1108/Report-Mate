import { describe, expect, it } from "vitest";
import {
  getUserRoleLabel,
  USER_ROLE_LABELS,
  USER_ROLES,
} from "./contracts";

describe("user role labels", () => {
  it("maps canonical authorization values to display labels", () => {
    expect(USER_ROLE_LABELS).toEqual({
      dispatcher_admin: "Admin",
      technician: "Worker",
    });
    expect(getUserRoleLabel(USER_ROLES.admin)).toBe("Admin");
    expect(getUserRoleLabel(USER_ROLES.worker)).toBe("Worker");
  });
});
