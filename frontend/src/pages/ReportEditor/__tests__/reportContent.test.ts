// Tests for the wire<->UI boundary and the required-field check.
//
// These two are the parts of the renderer with no visual tell when they are
// wrong: a mis-narrowed value renders as an empty control (looks like an empty
// report, not a bug), and a missed required field is only discovered by the
// server after the technician thought they were done.

import { describe, expect, it } from "vitest";
import type { TemplateSchema } from "../../../api/types";
import {
  contentFromWire,
  contentToWire,
  emptyContentForSchema,
  findMissingRequiredFields,
  isFieldValueEmpty,
} from "../reportContent";

const schema: TemplateSchema = {
  version: 1,
  sections: [
    {
      id: "sec_a",
      label: "Section A",
      fields: [
        { id: "f_text", type: "text", label: "Notes", required: true },
        { id: "f_num", type: "number", label: "Reading", required: true },
        {
          id: "f_sel",
          type: "select",
          label: "System",
          required: true,
          options: ["Split", "Packaged"],
        },
        {
          id: "f_chk",
          type: "checklist",
          label: "Checks",
          required: true,
          options: ["A", "B"],
        },
        { id: "f_photo", type: "photo", label: "Photo", required: true },
        { id: "f_sig", type: "signature", label: "Sign-off", required: true },
      ],
    },
  ],
};

describe("contentFromWire", () => {
  it("narrows every field type to its UI shape", () => {
    const content = contentFromWire(schema, {
      values: {
        f_text: "hello",
        f_num: 42, // a JSON number, not a string
        f_sel: "Split",
        f_chk: ["A", 7, "B"], // a non-string sneaks in
        f_photo: { dataUrl: "data:image/jpeg;base64,xx", caption: "c" },
        f_sig: "data:image/png;base64,yy",
      },
      parts: [{ id: "p1", part: "Filter", partNumber: "AF-1", quantity: "2" }],
      filledBy: "manual",
    });

    expect(content.values.f_text).toBe("hello");
    expect(content.values.f_num).toBe("42");
    expect(content.values.f_sel).toBe("Split");
    expect(content.values.f_chk).toEqual(["A", "B"]);
    expect(content.values.f_photo).toEqual({
      dataUrl: "data:image/jpeg;base64,xx",
      caption: "c",
      fileName: undefined,
    });
    expect(content.values.f_sig).toBe("data:image/png;base64,yy");
    expect(content.parts).toHaveLength(1);
  });

  it("falls back to the empty value for junk, rather than throwing", () => {
    const content = contentFromWire(schema, {
      values: {
        f_text: { not: "a string" },
        f_num: "not a number but still a string",
        f_chk: "A",
        f_photo: "not an object",
        f_sig: "", // "" means unsigned; normalized to null
      },
      parts: [],
      filledBy: "manual",
    });

    expect(content.values.f_text).toBe("");
    expect(content.values.f_num).toBe("not a number but still a string");
    expect(content.values.f_chk).toEqual([]);
    expect(content.values.f_photo).toEqual({ dataUrl: null, caption: "" });
    expect(content.values.f_sig).toBeNull();
  });

  it("is schema-driven: unknown stored keys are dropped, missing ones filled", () => {
    const content = contentFromWire(schema, {
      values: { f_text: "kept", f_removed_field: "dropped" },
      parts: [],
      filledBy: "manual",
    });

    expect(Object.keys(content.values).sort()).toEqual([
      "f_chk",
      "f_num",
      "f_photo",
      "f_sel",
      "f_sig",
      "f_text",
    ]);
  });

  it("handles a null/absent content body", () => {
    const content = contentFromWire(schema, null);
    expect(content).toEqual(emptyContentForSchema(schema));
  });

  it("mints an id for a parts row that arrives without one", () => {
    const content = contentFromWire(schema, {
      values: {},
      parts: [{ part: "X", partNumber: "Y", quantity: 3 } as never],
      filledBy: "manual",
    });
    expect(content.parts[0].id).toBeTruthy();
    expect(content.parts[0].quantity).toBe("3");
  });
});

describe("contentToWire", () => {
  it("round-trips through the boundary unchanged", () => {
    const original = contentFromWire(schema, {
      values: {
        f_text: "hello",
        f_chk: ["A"],
        f_photo: { dataUrl: "data:x", caption: "cap", fileName: "a.jpg" },
        f_sig: "data:sig",
      },
      parts: [{ id: "p1", part: "Filter", partNumber: "AF-1", quantity: "2" }],
      filledBy: "manual",
    });

    expect(contentFromWire(schema, contentToWire(original))).toEqual(original);
  });

  it("copies rather than aliasing the editor's state", () => {
    const content = emptyContentForSchema(schema);
    const wire = contentToWire(content);
    expect(wire.values).not.toBe(content.values);
    expect(wire.parts).not.toBe(content.parts);
  });
});

describe("isFieldValueEmpty", () => {
  const field = (id: string) => schema.sections[0].fields.find((f) => f.id === id)!;

  it("treats whitespace-only text as empty", () => {
    expect(isFieldValueEmpty(field("f_text"), "   ")).toBe(true);
    expect(isFieldValueEmpty(field("f_text"), " x ")).toBe(false);
  });

  it("treats a caption without an image as an empty photo", () => {
    expect(
      isFieldValueEmpty(field("f_photo"), { dataUrl: null, caption: "a caption" }),
    ).toBe(true);
    expect(
      isFieldValueEmpty(field("f_photo"), { dataUrl: "data:x", caption: "" }),
    ).toBe(false);
  });

  it("treats an empty checklist and an unsigned pad as empty", () => {
    expect(isFieldValueEmpty(field("f_chk"), [])).toBe(true);
    expect(isFieldValueEmpty(field("f_chk"), ["A"])).toBe(false);
    expect(isFieldValueEmpty(field("f_sig"), null)).toBe(true);
    expect(isFieldValueEmpty(field("f_sig"), "data:sig")).toBe(false);
  });
});

describe("findMissingRequiredFields", () => {
  it("returns every blank required field in document order", () => {
    const missing = findMissingRequiredFields(schema, emptyContentForSchema(schema));
    expect(missing.map((m) => m.fieldId)).toEqual([
      "f_text",
      "f_num",
      "f_sel",
      "f_chk",
      "f_photo",
      "f_sig",
    ]);
    expect(missing[0].sectionLabel).toBe("Section A");
  });

  it("ignores optional fields", () => {
    const optional: TemplateSchema = {
      version: 1,
      sections: [
        {
          id: "s",
          label: "S",
          fields: [{ id: "f", type: "text", label: "Optional", required: false }],
        },
      ],
    };
    expect(
      findMissingRequiredFields(optional, emptyContentForSchema(optional)),
    ).toEqual([]);
  });

  it("returns nothing once every required field is filled", () => {
    const content = contentFromWire(schema, {
      values: {
        f_text: "notes",
        f_num: "42",
        f_sel: "Split",
        f_chk: ["A"],
        f_photo: { dataUrl: "data:x", caption: "" },
        f_sig: "data:sig",
      },
      parts: [],
      filledBy: "manual",
    });
    expect(findMissingRequiredFields(schema, content)).toEqual([]);
  });
});
