// FieldList — the nested sortable list of fields inside one section (Req 3.5).
//
// SCOPE (task 10.2): renders a per-section `SortableContext` (vertical) whose
// items are the section's fields, each rendered as a <FieldCard>. The section's
// droppable field AREA (so palette blocks and cross-section field drops land
// here, including on an empty section) is owned by <SectionCard> — this
// component only owns the sortable ordering of the fields it is given.
//
// An empty section still renders an explicit drop hint so there is a visible
// place to drop the first field (Req 3.6 — empty target places the field as its
// sole field). The SectionCard droppable wraps this, so the empty case resolves
// to that section.

import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { Field } from "../../api/types";
import type { BuilderAction } from "./builderReducer";
import { FieldCard, fieldDndId } from "./FieldCard";

interface FieldListProps {
  sectionId: string;
  fields: Field[];
  // Threaded down to each FieldCard so its FieldPropertyEditor can dispatch
  // label/required/option edits (task 10.4).
  dispatch: (action: BuilderAction) => void;
}

export function FieldList({ sectionId, fields, dispatch }: FieldListProps) {
  const items = fields.map((f) => fieldDndId(f.id));

  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <div data-testid={`field-list-${sectionId}`}>
        {fields.length === 0 ? (
          <p
            data-testid={`field-list-empty-${sectionId}`}
            style={{
              margin: 0,
              padding: 12,
              color: "#555",
              fontSize: 14,
              fontStyle: "italic",
            }}
          >
            Drop a field here
          </p>
        ) : (
          fields.map((field) => (
            <FieldCard
              key={field.id}
              field={field}
              sectionId={sectionId}
              dispatch={dispatch}
            />
          ))
        )}
      </div>
    </SortableContext>
  );
}

export default FieldList;
