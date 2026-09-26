// SectionCard — one section: a sortable card whose field area is a droppable
// (Req 3.4 reorder sections; Req 2.2 / 3.6 drop fields into a section).
//
// SCOPE (task 10.2):
//   - The whole card is a dnd-kit `useSortable` node so sections can be
//     reordered. Its drag data is `{ source: "section", sectionId }`.
//   - The field area is a `useDroppable` target so palette blocks and fields can
//     be dropped into this section — including onto an EMPTY section (Req 3.6).
//     Its droppable data is `{ source: "section", sectionId }` so onDragEnd can
//     resolve the target section from `event.over` when the drop lands on the
//     area rather than on a specific field.
//   - A dedicated drag HANDLE starts the section drag, so drops/taps inside the
//     field area (fields, the required checkbox, future editors) are not
//     hijacked by the section-level sortable listeners.
//
// Task 10.3 adds the section DELETE flow: the delete button is enabled and,
// when the section contains one or more fields, deletion is gated behind a
// ConfirmDialog; only after Confirm does it dispatch removeSection (Req 3.8,
// 3.9). An empty section is deleted immediately (the confirm requirement is
// specifically for non-empty sections per Req 3.8).
//
// Task 10.4 replaces the read-only section-label heading with an editable
// input: on commit (blur/Enter) a non-empty trimmed value dispatches
// renameSection (Req 4.8); an empty/whitespace-only value is rejected — the
// input reverts to the previous label and a "Label is required" message shows
// (Req 4.9).

import { useEffect, useState } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import type { Section } from "../../api/types";
import type { BuilderAction } from "./builderReducer";
import { FieldList } from "./FieldList";
import { ConfirmDialog } from "./ConfirmDialog";
import { colors, fontSize, radius, spacing, tapTargetStyle } from "../../styles/tokens";

// Stable dnd id for a section sortable. The section's droppable field area uses
// the SAME id, so `event.over.id === sectionDndId(id)` unambiguously means "the
// pointer is over this section's area but not over a specific field".
export function sectionDndId(sectionId: string): string {
  return `section:${sectionId}`;
}

// Drag/drop data shared by the section sortable and its droppable area.
export interface SectionDragData {
  source: "section";
  sectionId: string;
}

interface SectionCardProps {
  section: Section;
  // Reducer dispatch threaded down from TemplateBuilderPage via SectionList so
  // the delete control can dispatch removeSection (Req 3.9).
  dispatch: (action: BuilderAction) => void;
}

export function SectionCard({ section, dispatch }: SectionCardProps) {
  const data: SectionDragData = { source: "section", sectionId: section.id };

  // Whether the delete-confirmation dialog is open. It is only opened for a
  // non-empty section (Req 3.8); empty sections delete immediately.
  const [confirmOpen, setConfirmOpen] = useState(false);

  const hasFields = section.fields.length > 0;

  // Editable section label (Req 4.8/4.9). Local draft for smooth typing;
  // committed on blur/Enter, reverted on Escape.
  const [draftLabel, setDraftLabel] = useState(section.label);
  const [labelError, setLabelError] = useState(false);

  useEffect(() => {
    setDraftLabel(section.label);
  }, [section.label]);

  const commitLabel = () => {
    const trimmed = draftLabel.trim();
    if (trimmed === "") {
      // Reject: retain previous label, revert input, show the message (Req 4.9).
      setDraftLabel(section.label);
      setLabelError(true);
      return;
    }
    setLabelError(false);
    if (trimmed !== section.label) {
      dispatch({ kind: "renameSection", sectionId: section.id, label: trimmed });
    }
  };

  // Delete request from the trash button. A section with fields requires
  // confirmation (Req 3.8); an empty section is removed right away.
  const handleDeleteClick = () => {
    if (hasFields) {
      setConfirmOpen(true);
      return;
    }
    dispatch({ kind: "removeSection", sectionId: section.id });
  };

  // Fired only after the dispatcher confirms in the dialog (Req 3.8, 3.9).
  const handleConfirmDelete = () => {
    setConfirmOpen(false);
    dispatch({ kind: "removeSection", sectionId: section.id });
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: sectionDndId(section.id), data });

  // The field area is a droppable resolving to this section (used when a drop
  // lands on the section but not on a specific field — e.g. an empty section).
  const { setNodeRef: setDropRef, isOver } = useDroppable({
    id: sectionDndId(section.id),
    data,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    marginBottom: spacing.lg,
    border: `2px solid ${colors.border}`,
    borderRadius: radius.lg,
    background: colors.surfaceMuted,
    // Contain the card within the page width so its header/field rows never
    // push past the screen edge.
    minWidth: 0,
    maxWidth: "100%",
    overflowX: "hidden",
  };

  const fieldAreaStyle: React.CSSProperties = {
    padding: spacing.md,
    borderRadius: radius.md,
    // High-contrast drop highlight (text stays 14:1 on it, Req 8.3).
    background: isOver ? colors.dropHighlight : "transparent",
    minHeight: 56,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      data-testid={`section-card-${section.id}`}
      {...attributes}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: spacing.md,
          padding: spacing.md,
          borderBottom: `1px solid ${colors.borderSubtle}`,
          minWidth: 0,
        }}
      >
        {/*
          Drag handle: only this control carries the sortable listeners, so
          dragging a field or tapping a control inside the field area does not
          start a section drag.
        */}
        <button
          type="button"
          aria-label={`Drag section ${section.label}`}
          data-testid={`section-drag-handle-${section.id}`}
          style={{
            ...tapTargetStyle,
            flexShrink: 0,
            cursor: "grab",
            touchAction: "none",
            fontSize: fontSize.lg,
            border: `1px solid ${colors.border}`,
            borderRadius: radius.md,
            background: colors.surface,
            color: colors.text,
          }}
          {...listeners}
        >
          ⠿
        </button>
        {/*
          Editable section label (Req 4.8/4.9). stopPropagation on pointer/key
          keeps typing here from starting the section drag (the handle owns the
          sortable listeners).
        */}
        <input
          type="text"
          value={draftLabel}
          aria-label="Section label"
          data-testid={`section-label-input-${section.id}`}
          aria-invalid={labelError}
          onChange={(e) => {
            setDraftLabel(e.target.value);
            if (labelError) setLabelError(false);
          }}
          onBlur={commitLabel}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") {
              e.preventDefault();
              commitLabel();
            } else if (e.key === "Escape") {
              e.preventDefault();
              setDraftLabel(section.label);
              setLabelError(false);
            }
          }}
          style={{
            flex: 1,
            minWidth: 0,
            boxSizing: "border-box",
            minHeight: tapTargetStyle.minHeight,
            fontSize: fontSize.lg,
            fontWeight: 600,
            padding: `${spacing.sm}px ${spacing.md}px`,
            border: `1px solid ${labelError ? colors.danger : colors.border}`,
            borderRadius: radius.md,
            background: colors.surface,
            color: colors.text,
          }}
        />
        {/*
          Delete control (Req 3.8, 3.9). stopPropagation on pointer-down keeps a
          tap here from starting the section drag (the drag handle above owns the
          sortable listeners). A non-empty section opens the ConfirmDialog; an
          empty section is deleted immediately.
        */}
        <button
          type="button"
          aria-label={`Delete section ${section.label}`}
          data-testid={`section-delete-${section.id}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={handleDeleteClick}
          style={{
            ...tapTargetStyle,
            flexShrink: 0,
            border: `1px solid ${colors.danger}`,
            borderRadius: radius.md,
            background: colors.surface,
            color: colors.dangerText,
            cursor: "pointer",
          }}
        >
          🗑
        </button>
      </div>

      {labelError && (
        <p
          role="alert"
          data-testid={`section-label-error-${section.id}`}
          style={{
            margin: `${spacing.sm}px ${spacing.md}px 0`,
            color: colors.dangerText,
            fontSize: fontSize.sm,
          }}
        >
          Label is required
        </p>
      )}

      <div ref={setDropRef} style={fieldAreaStyle}>
        <FieldList
          sectionId={section.id}
          fields={section.fields}
          dispatch={dispatch}
        />
      </div>

      <ConfirmDialog
        open={confirmOpen}
        title="Delete section"
        message={`Delete "${section.label}" and its ${section.fields.length} field${
          section.fields.length === 1 ? "" : "s"
        }? This cannot be undone.`}
        confirmLabel="Delete section"
        onConfirm={handleConfirmDelete}
        onCancel={() => setConfirmOpen(false)}
      />
    </div>
  );
}

export default SectionCard;
