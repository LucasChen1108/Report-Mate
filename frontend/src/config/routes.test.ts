import { describe, expect, it } from "vitest";
import { routeBuilders, ROUTES } from "./routes";

describe("frontend routes", () => {
  it("retains a route pattern for template detail pages", () => {
    expect(ROUTES.templateDetail).toBe("/templates/:id");
  });

  it("builds a concrete template path with an encoded id", () => {
    expect(routeBuilders.template("template/with spaces"))
      .toBe("/templates/template%2Fwith%20spaces");
  });
});
