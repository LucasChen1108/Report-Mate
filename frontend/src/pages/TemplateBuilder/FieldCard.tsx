// FieldCard — a single sortable field within a section (Req 3.5, 3.6).
//
// SCOPE (task 10.2): a FieldCard is a dnd-kit `useSortable` node whose drag data
// carries the discriminant TemplateBuilderPage.onDragEnd branches on:
// `{ source: "field", fieldId, sectionId }` (design "dnd-kit wiring"). It shows
// the field TYPE as a badge and hosts the field editor.
//
// SCOPE (task 10.4): a dedicated drag HANDLE carries the sortable listeners, so
// the field body — now the <FieldPropertyEditor> (editable label with
// empty/whitespace rejection, working required toggle, and <OptionListEditor>
// for select/checklist) — can be typed in and tapped without starting a drag.

import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Field } from "../../api/types";
import type { BuilderAction } from "./builderReducer";
import { FieldPropertyEditor } from "./FieldPropertyEditor";
import { colors, fontSize, radius, spacing, tapTargetStyle } from "../../styles/tokens";

// Stable dnd id for a field sortable/droppable. Kept in one place so the page's
// onDragEnd and this component agree on the id shape.
export function fieldDndId(fieldId: string): string {
  return `field:${fieldId}`;
}

// Drag data attached to every field sortable. The `source` discriminant lets
// onDragEnd tell field drags apart from palette/section drags.
export interface FieldDragData {
  source: "field";
  fieldId: string;
  sectionId: string;
}

interface FieldCardProps {
  field: Field;
  sectionId: string;
  // Reducer dispatch threaded down from TemplateBuilderPage via SectionList ->
  // SectionCard -> FieldList so the property editor can dispatch renameField /
  // setRequired / option edits (Req 4.1–4.7).
  dispatch: (action: BuilderAction) => void;
}

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: `2px ${spacing.sm}px`,
  borderRadius: radius.sm,
  border: `1px solid ${colors.border}`,
  background: colors.pageBg,
  color: colors.text, // 16:1 on pageBg (Req 8.3)
  fontSize: fontSize.xs,
  textTransform: "uppercase",
  letterSpacing: 0.5,
};

export function FieldCard({ field, sectionId, dispatch }: FieldCardProps) {
  const dragData: FieldDragData = {
    source: "field",
    fieldId: field.id,
    sectionId,
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: fieldDndId(field.id), data: dragData });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    display: "flex",
    alignItems: "flex-start",
    gap: spacing.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
    border: `1px solid ${colors.border}`,
    borderRadius: radius.md,
    background: colors.surface,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`field-card-${field.id}`}
      {...attributes}
    >
      {/*
        Drag handle: only this control carries the sortable listeners so typing
        in the editor inputs or tapping the required toggle / option controls
        does not start a field drag. touchAction:none keeps touch drags from
        scrolling instead.
      */}
      <button
        type="button"
        aria-label={`Drag field ${field.label}`}
        data-testid={`field-drag-handle-${field.id}`}
        style={{
          ...tapTargetStyle, // >=44x44 CSS px (Req 8.2)
          cursor: "grab",
          touchAction: "none",
          fontSize: fontSize.base,
          border: `1px solid ${colors.border}`,
          borderRadius: radius.md,
          background: colors.surface,
          color: colors.text,
        }}
        {...listeners}
      >
        ⠿
      </button>
      <span style={badgeStyle} data-testid={`field-type-${field.id}`}>
        {field.type}
      </span>
      <FieldPropertyEditor field={field} dispatch={dispatch} />
    </div>
  );
}

export default FieldCard;
