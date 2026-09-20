import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TemplateService } from "../contracts";
import { createMockServiceBundle } from "../createServices";
import { MemoryStorage } from "./MockSessionManager";

describe("MockTemplateService", () => {
  let templates: TemplateService;

  beforeEach(() => {
    templates = createMockServiceBundle({
      storage: new MemoryStorage(),
      clock: () => new Date("2026-09-20T00:00:00.000Z"),
      idGenerator: (kind) => `generated-${kind}`,
    }).templates;
  });

  it("lists and opens disposable seed templates without fetch", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const summaries = await templates.list();
    expect(summaries.length).toBeGreaterThanOrEqual(2);
    expect(summaries.every((template) => !("schema" in template))).toBe(true);
    await expect(templates.get(summaries[0].id)).resolves.toMatchObject({
      id: summaries[0].id,
      schema: { version: 1 },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it("creates and updates templates in the shared store", async () => {
    const schema = {
      version: 1 as const,
      sections: [{ id: "section", label: "Details", fields: [] }],
    };
    const created = await templates.create({ name: "  New Template  ", schema });
    expect(created).toMatchObject({
      id: "generated-template",
      name: "New Template",
      isSeed: false,
    });
    expect(await templates.list()).toContainEqual(
      expect.objectContaining({ id: created.id, name: "New Template" }),
    );

    const updated = await templates.update(created.id, {
      name: "Updated Template",
      schema,
    });
    expect(updated.name).toBe("Updated Template");
    await expect(templates.get(created.id)).resolves.toMatchObject({
      name: "Updated Template",
    });
  });

  it("reports validation and missing-template failures", async () => {
    await expect(
      templates.create({
        name: " ",
        schema: {
          version: 1,
          sections: [{ id: "section", label: "Details", fields: [] }],
        },
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(templates.get("missing")).rejects.toMatchObject({
      code: "not_found",
    });
  });
});
