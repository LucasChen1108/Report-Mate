// ChecklistFieldControl — editable control for a `checklist` field (multi-choice).
//
// Same large tap-target choice pattern as select (Req 8.4), but multiple options
// can be toggled on/off independently. Value is the array of chosen options.
// Toggling preserves the field's original option order rather than click order,
// so the rendered/exported document reads consistently.

import { spacing } from "../../../styles/tokens";
import type { ChecklistValue } from "../reportContent";
import { FieldLabel } from "./TextFieldControl";

interface ChecklistFieldControlProps {
  id: string;
  label: string;
  required: boolean;
  options: string[];
  value: ChecklistValue;
  onChange: (next: ChecklistValue) => void;
}

export function ChecklistFieldControl({
  id,
  label,
  required,
  options,
  value,
  onChange,
}: ChecklistFieldControlProps) {
  const chosen = new Set(value);

  const toggle = (option: string) => {
    const next = new Set(chosen);
    if (next.has(option)) {
      next.delete(option);
    } else {
      next.add(option);
    }
    // Re-emit in the field's declared option order for stable rendering.
    onChange(options.filter((o) => next.has(o)));
  };

  return (
    <div role="group" aria-label={label} data-testid={`checklist-${id}`}>
      <FieldLabel label={label} required={required} />
      <div className="rm-choice" style={{ marginTop: spacing.xs }}>
        {options.map((option) => {
          const selected = chosen.has(option);
          return (
            <button
              key={option}
              type="button"
              className="rm-choice__option"
              role="checkbox"
              aria-checked={selected}
              data-selected={selected}
              data-testid={`checklist-${id}-option-${option}`}
              onClick={() => toggle(option)}
            >
              <span aria-hidden="true" style={{ marginRight: spacing.sm }}>
                {selected ? "☑" : "☐"}
              </span>
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
