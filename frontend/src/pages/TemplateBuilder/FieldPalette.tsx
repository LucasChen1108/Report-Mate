// FieldPalette — the row of draggable field-type blocks (Req 2.1).
//
// Renders EXACTLY one draggable block per Field_Type. The list is derived from
// a single constant tuple typed against the `FieldType` union so it can never
// drift out of sync with the contract in api/types.ts — if a member is added to
// or removed from the union, this file fails to type-check until the tuple is
// updated.
//
// Each block is a dnd-kit `useDraggable` whose drag data carries the discriminant
// the page's onDragEnd branches on: `{ source: "palette", type }`
// (design "dnd-kit wiring" — Palette -> section). The actual add-on-drop
// dispatch is wired in task 10.2; this component only produces the draggables.

import { useDraggable } from "@dnd-kit/core";
import type { FieldType } from "../../api/types";
import { colors, fontSize, radius, spacing } from "../../styles/tokens";

// Drag data attached to every palette draggable. The `source` discriminant lets
// TemplateBuilderPage.onDragEnd tell palette drags apart from field/section
// drags without ambiguity (design "dnd-kit wiring").
export interface PaletteDragData {
  source: "palette";
  type: FieldType;
}

// The six field types, in palette display order. Typed as a readonly tuple of
// `FieldType` so the compiler enforces that every union member appears exactly
// once (and nothing outside the union sneaks in).
const PALETTE_TYPES: readonly FieldType[] = [
  "text",
  "number",
  "select",
  "checklist",
  "photo",
  "signature",
];

// Human-readable label for each block. Keyed by FieldType so a missing/extra
// key is a compile error.
const PALETTE_LABELS: Record<FieldType, string> = {
  text: "Text",
  number: "Number",
  select: "Select",
  checklist: "Checklist",
  photo: "Photo",
  signature: "Signature",
};

const paletteStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: spacing.md,
  padding: spacing.md,
};

const blockBaseStyle: React.CSSProperties = {
  // Large tap targets from the theme (Req 8.2): comfortably >=44x44 CSS px so
  // the palette blocks are easy to grab one-handed / gloves-on.
  minWidth: 96,
  minHeight: 48,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: `${spacing.md}px ${spacing.lg}px`,
  border: `1px solid ${colors.border}`,
  borderRadius: radius.md,
  background: colors.surface,
  color: colors.text, // 17.4:1 on surface (Req 8.3)
  cursor: "grab",
  touchAction: "none",
  userSelect: "none",
  fontSize: fontSize.base,
};

interface PaletteBlockProps {
  type: FieldType;
}

function PaletteBlock({ type }: PaletteBlockProps) {
  const dragData: PaletteDragData = { source: "palette", type };
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: `palette-${type}`,
      data: dragData,
    });

  const style: React.CSSProperties = {
    ...blockBaseStyle,
    opacity: isDragging ? 0.5 : 1,
    transform: transform
      ? `translate3d(${transform.x}px, ${transform.y}px, 0)`
      : undefined,
  };

  return (
    <button
      ref={setNodeRef}
      type="button"
      style={style}
      data-testid={`palette-${type}`}
      aria-label={`Add ${PALETTE_LABELS[type]} field`}
      {...listeners}
      {...attributes}
    >
      {PALETTE_LABELS[type]}
    </button>
  );
}

export function FieldPalette() {
  return (
    <div style={paletteStyle} data-testid="field-palette" aria-label="Field palette">
      {PALETTE_TYPES.map((type) => (
        <PaletteBlock key={type} type={type} />
      ))}
    </div>
  );
}

export default FieldPalette;
