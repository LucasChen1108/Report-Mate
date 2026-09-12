// SectionList — the vertical sortable list of sections (Req 3.4).
//
// SCOPE (task 10.2): renders the top-level `SortableContext` (vertical) whose
// items are the schema's sections, each a <SectionCard>. It receives the working
// schema and the reducer dispatch from TemplateBuilderPage and passes them down.
//
// The actual drag resolution (which reducer action to dispatch on drop) lives in
// TemplateBuilderPage.onDragEnd — this component owns only the section ordering
// context and rendering. `dispatch` is threaded down to each SectionCard for the
// section delete flow (task 10.3, Req 3.8/3.9).

import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import type { TemplateSchema } from "../../api/types";
import type { BuilderAction } from "./builderReducer";
import { SectionCard, sectionDndId } from "./SectionCard";

interface SectionListProps {
  schema: TemplateSchema;
  dispatch: (action: BuilderAction) => void;
}

export function SectionList({ schema, dispatch }: SectionListProps) {
  const items = schema.sections.map((s) => sectionDndId(s.id));

  return (
    <SortableContext items={items} strategy={verticalListSortingStrategy}>
      <section
        data-testid="section-list"
        aria-label="Sections"
        style={{ marginTop: 16 }}
      >
        {schema.sections.map((section) => (
          <SectionCard key={section.id} section={section} dispatch={dispatch} />
        ))}
      </section>
    </SortableContext>
  );
}

export default SectionList;
