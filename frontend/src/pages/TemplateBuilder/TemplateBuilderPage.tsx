// TemplateBuilderPage — the shell of the drag-and-drop template editor.
//
// SCOPE (task 10.1 + 10.2): this file owns the editor shell AND the real
// onDragEnd dispatch wiring. It:
//   - owns the working TemplateSchema via useReducer(builderReducer, initial),
//   - owns the template name (useState) and a dirty flag (true after the first
//     schema mutation or name change),
//   - hosts the single dnd-kit <DndContext> coordinating all three drag
//     scenarios (palette->section add, in-section reorder, cross-section move,
//     plus section reorder), with sensors configured so taps on controls are
//     not hijacked,
//   - renders the FieldPalette and mounts the SectionList,
//   - resolves each drop against the CURRENT schema state and dispatches the
//     matching reducer action (task 10.2).
//
// Task 10.3 adds the section add flow: an <AddSectionForm> near the SectionList
// lets the dispatcher add a new section (Req 3.1–3.3). Section delete lives in
// SectionCard (also 10.3) and dispatches through the same reducer.
//
// SCOPE (task 11.1): this file now also owns the save/update orchestration.
// The bare name input + TODO(11.1) seam in the header is replaced with
// <SaveBar>. The page tracks whether it is editing an existing template
// (templateId), the in-flight saving flag, and the save status, and decides
// create-vs-update here (co-located with the schema/templateId state). All
// persistence calls flow through the injected TemplateService (Req 5.7).
//
// OUT OF SCOPE here (leave the seams for those tasks):
//   - 10.4: FieldPropertyEditor / OptionListEditor.
//   - 11.2: TemplateListPage (open flow passes initialTemplateId in).
//   - 11.3: route guard.
//   - 12.x: mobile-first high-contrast styling.
//   - 10.5 / 11.4 / 11.5: tests.

import { useEffect, useReducer, useState } from "react";
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import type { TemplateSchema } from "../../api/types";
import { TemplateValidationError } from "../../services/errors";
import { useServices } from "../../services/ServiceProvider";
import { builderReducer } from "./builderReducer";
import type { BuilderAction } from "./builderReducer";
import { FieldPalette } from "./FieldPalette";
import type { PaletteDragData } from "./FieldPalette";
import { SectionList } from "./SectionList";
import { AddSectionForm } from "./AddSectionForm";
import { SaveBar } from "./SaveBar";
import type { SaveStatus } from "./SaveBar";
import type { FieldDragData } from "./FieldCard";
import type { SectionDragData } from "./SectionCard";

// A sensible starting schema. Note: backend Validate requires >= 1 section, so
// the editor opens on a single default section rather than an empty template.
// Callers that open an existing template (task 11.2) will pass that schema in
// instead of this default.
function makeInitialSchema(): TemplateSchema {
  return {
    version: 1,
    sections: [
      {
        id: "sec_1",
        label: "Untitled section",
        fields: [],
      },
    ],
  };
}

// --- Drag-data discriminants -------------------------------------------------
// Palette drags carry PaletteDragData ({ source: "palette", type }); field drags
// carry FieldDragData ({ source: "field", fieldId, sectionId }); section drags
// carry SectionDragData ({ source: "section", sectionId }). All three are defined
// alongside the components that produce them and imported here so onDragEnd's
// branch is total.
type DragData = PaletteDragData | FieldDragData | SectionDragData;

// Drop-target data attached to droppables/sortables. A field sortable and a
// section droppable both carry their own discriminated data, matching DragData's
// field/section variants — that is what onDragEnd reads off `event.over`.
type DropData = FieldDragData | SectionDragData;

// Resolve which section a drop landed in, and the insert index within that
// section, from the `over` target and the current schema.
//   - over is a FIELD  -> target = that field's section, index = that field's
//                         position (insert before it).
//   - over is a SECTION-> target = that section, index = end of its field list
//                         (append; empty section -> index 0).
// Returns null when the target cannot be resolved (e.g. unknown id).
function resolveDropTarget(
  schema: TemplateSchema,
  over: DropData,
): { sectionId: string; index: number } | null {
  if (over.source === "field") {
    for (const section of schema.sections) {
      const fieldIndex = section.fields.findIndex((f) => f.id === over.fieldId);
      if (fieldIndex !== -1) {
        return { sectionId: section.id, index: fieldIndex };
      }
    }
    return null;
  }
  // over.source === "section": append at the end of that section.
  const section = schema.sections.find((s) => s.id === over.sectionId);
  if (!section) return null;
  return { sectionId: section.id, index: section.fields.length };
}

interface TemplateBuilderPageProps {
  // Task 11.2 (open flow) passes a loaded template's schema/name/id here.
  // Defaults keep the shell self-contained for a brand-new template.
  initialSchema?: TemplateSchema;
  initialName?: string;
  // When opened on an existing template, its id. Presence flips save from
  // create (Req 5.1) to update (Req 5.3). Absent for a brand-new template.
  initialTemplateId?: string;
  // Optional observers so a host shell can watch the live working schema/name
  // (e.g. to preview the in-progress template in the Report Renderer without a
  // backend round-trip). Both are optional and default to no-ops, so existing
  // callers are unaffected.
  onSchemaChange?: (schema: TemplateSchema) => void;
  onNameChange?: (name: string) => void;
}

export function TemplateBuilderPage({
  initialSchema,
  initialName = "",
  initialTemplateId,
  onSchemaChange,
  onNameChange,
}: TemplateBuilderPageProps) {
  const { templates: templateService } = useServices();
  const [schema, rawDispatch] = useReducer(
    builderReducer,
    initialSchema,
    (loaded) => loaded ?? makeInitialSchema(),
  );
  const [name, setName] = useState(initialName);
  const [dirty, setDirty] = useState(false);

  // Whether we are editing an existing template. Starts from the prop (open
  // flow); after a successful CREATE we store the returned record's id here so
  // subsequent saves UPDATE rather than create again (Req 5.1 -> 5.3).
  const [templateId, setTemplateId] = useState<string | undefined>(
    initialTemplateId,
  );
  // True while a save request is in flight — disables Save in the SaveBar.
  const [saving, setSaving] = useState(false);
  // What the SaveBar surfaces: nothing, a brief saved indicator, or an error.
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ kind: "idle" });

  // Notify an optional host shell whenever the committed schema/name change, so
  // it can mirror the live template (e.g. preview it in the Report Renderer).
  // Effects fire after commit, so these always reflect the current state.
  useEffect(() => {
    onSchemaChange?.(schema);
  }, [schema, onSchemaChange]);
  useEffect(() => {
    onNameChange?.(name);
  }, [name, onNameChange]);

  // Any schema mutation marks the editor dirty and clears a stale saved
  // indicator (a fresh edit means there are unsaved changes again).
  const dispatch = (action: BuilderAction) => {
    setDirty(true);
    if (saveStatus.kind === "saved") setSaveStatus({ kind: "idle" });
    rawDispatch(action);
  };

  const handleNameChange = (next: string) => {
    setDirty(true);
    if (saveStatus.kind === "saved") setSaveStatus({ kind: "idle" });
    setName(next);
  };

  // Save orchestration (Req 5.1, 5.3, 5.5, 5.6, 5.7).
  //   - Empty (trimmed) name blocks the save with a message and never calls the
  //     API (Req 5.5).
  //   - With a templateId -> updateTemplate (Req 5.3); otherwise createTemplate
  //     (Req 5.1), and on success store the new id so later saves update.
  //   - On success: clear dirty and show a brief saved indicator.
  //   - On failure: RETAIN all unsaved edits (nothing is cleared) and surface
  //     the error; for a 422 include the offending elementId (Req 5.6). All
  //     calls go through TemplateService (Req 5.7).
  const handleSave = async () => {
    if (saving) return;

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      setSaveStatus({ kind: "error", message: "Template name is required" });
      return;
    }

    setSaving(true);
    setSaveStatus({ kind: "idle" });
    try {
      const record =
        templateId !== undefined
          ? await templateService.update(templateId, {
              name: trimmedName,
              schema,
            })
          : await templateService.create({ name: trimmedName, schema });

      // A create returns the new id; keep it so the next save updates.
      setTemplateId(record.id);
      setDirty(false);
      setSaveStatus({ kind: "saved" });
    } catch (err) {
      // Retain all unsaved edits (state is untouched on every branch below) and
      // surface the error (Req 5.6).
      if (err instanceof TemplateValidationError) {
        setSaveStatus({
          kind: "error",
          message: err.message,
          elementId: err.elementId,
        });
      } else {
        // Network / unexpected failure.
        setSaveStatus({
          kind: "error",
          message:
            err instanceof Error
              ? err.message
              : "Could not save the template. Please try again.",
        });
      }
    } finally {
      setSaving(false);
    }
  };

  // Add-section: AddSectionForm has already trimmed/validated the label
  // (1–100 chars, non-empty), so this just dispatches addSection, which appends
  // the new section last (Req 3.1).
  const handleAddSection = (label: string) => {
    dispatch({ kind: "addSection", label });
  };

  // Sensors: a small activation distance means a quick tap on a button/control
  // does not start a drag, so mobile tap targets stay tappable (Req 8).
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
  );

  // onDragEnd branches on the drag-data discriminant and resolves the drop
  // target from `event.over` against the CURRENT schema state (indices are read
  // from schema by id rather than trusting stale event indices).
  //
  // A release with no droppable target (`event.over === null`) never mutates the
  // schema (Req 2.6).
  const handleDragEnd = (event: DragEndEvent) => {
    const active = event.active.data.current as DragData | undefined;
    if (!active) return;

    // Released outside any droppable — dispatch nothing (Req 2.6).
    if (event.over === null) return;
    const over = event.over.data.current as DropData | undefined;
    if (!over) return;

    switch (active.source) {
      case "palette": {
        // Palette -> section: add a field of the dragged type at the resolved
        // drop position within the target section (Req 2.2). A drop on a
        // section's area (no specific field) appends at the end.
        const target = resolveDropTarget(schema, over);
        if (!target) return;
        dispatch({
          kind: "addField",
          sectionId: target.sectionId,
          type: active.type,
          atIndex: target.index,
        });
        return;
      }
      case "field": {
        // A field can only be dropped onto another field or a section area.
        const target = resolveDropTarget(schema, over);
        if (!target) return;

        // No-op if dropped onto itself.
        if (over.source === "field" && over.fieldId === active.fieldId) return;

        if (target.sectionId === active.sectionId) {
          // Same section: reorder within that section (Req 3.5). Read the
          // current from/to indices from the schema by id.
          const section = schema.sections.find(
            (s) => s.id === active.sectionId,
          );
          if (!section) return;
          const fromIndex = section.fields.findIndex(
            (f) => f.id === active.fieldId,
          );
          if (fromIndex === -1) return;
          if (fromIndex === target.index) return;
          dispatch({
            kind: "reorderField",
            sectionId: active.sectionId,
            fromIndex,
            toIndex: target.index,
          });
          return;
        }

        // Cross-section move (Req 3.6). Dropping onto an empty section (index 0)
        // places the field as that section's sole field.
        dispatch({
          kind: "moveField",
          fieldId: active.fieldId,
          toSectionId: target.sectionId,
          toIndex: target.index,
        });
        return;
      }
      case "section": {
        // Section reorder (Req 3.4). Resolve both indices from the schema by id.
        // Both DropData variants carry a `sectionId`, so a section dropped over
        // either another section's area or a field within it resolves to the
        // enclosing section.
        const overSectionId = over.sectionId;
        const fromIndex = schema.sections.findIndex(
          (s) => s.id === active.sectionId,
        );
        const toIndex = schema.sections.findIndex(
          (s) => s.id === overSectionId,
        );
        if (fromIndex === -1 || toIndex === -1) return;
        if (fromIndex === toIndex) return;
        dispatch({ kind: "reorderSections", fromIndex, toIndex });
        return;
      }
      default: {
        // Exhaustiveness guard: a new drag source must be handled above.
        const _exhaustive: never = active;
        return _exhaustive;
      }
    }
  };

  return (
    // .rm-page is the mobile-first container: full-width single column on a
    // phone (no horizontal overflow), capped/centered on wider viewports
    // (Req 8.1). Defined in styles/theme.css.
    <main className="rm-page">
      <header>
        <h1>Template Builder</h1>
        {/*
          SaveBar owns the template name input, the Save action, and the
          save-status/error surface. Create-vs-update orchestration lives here
          in handleSave (task 11.1).
        */}
        <SaveBar
          name={name}
          onNameChange={handleNameChange}
          onSave={handleSave}
          saving={saving}
          status={saveStatus}
        />
        {dirty && (
          <p data-testid="dirty-indicator" style={{ margin: "0 0 12px" }}>
            Unsaved changes
          </p>
        )}
      </header>

      <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
        <FieldPalette />

        {/*
          SectionList renders the sortable sections (each a droppable field area)
          and the nested sortable field lists. Section add/delete flows are task
          10.3; field property/option editing is task 10.4.
        */}
        <SectionList schema={schema} dispatch={dispatch} />
      </DndContext>

      {/*
        Add-section control (Req 3.1–3.3). Kept outside the DndContext since it
        is a plain form, not a drag surface. Placed just below the section list
        so a new (empty) section appears at the end.
      */}
      <AddSectionForm onAdd={handleAddSection} />
    </main>
  );
}

export default TemplateBuilderPage;
