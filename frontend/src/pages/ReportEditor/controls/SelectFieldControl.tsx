// SelectFieldControl — editable control for a `select` field (single choice).
//
// Per the design (Req 8.4) choices are rendered as a group of large tap-target
// buttons, NOT a native <select> — no tiny dropdowns in field conditions.
// Reuses the .rm-choice / .rm-choice__option classes from styles/theme.css.
// Tapping the already-selected option clears it (unless the field is required,
// in which case a choice can only be changed, not cleared).

import { spacing } from "../../../styles/tokens";
import { FieldLabel } from "./TextFieldControl";

interface SelectFieldControlProps {
  id: string;
  label: string;
  required: boolean;
  options: string[];
  value: string;
  onChange: (next: string) => void;
}

export function SelectFieldControl({
  id,
  label,
  required,
  options,
  value,
  onChange,
}: SelectFieldControlProps) {
  const handleClick = (option: string) => {
    if (value === option) {
      // Allow clearing an optional field by tapping the chosen option again.
      if (!required) onChange("");
      return;
    }
    onChange(option);
  };

  return (
    <div role="group" aria-label={label} data-testid={`select-${id}`}>
      <FieldLabel label={label} required={required} />
      <div className="rm-choice" style={{ marginTop: spacing.xs }}>
        {options.map((option) => {
          const selected = value === option;
          return (
            <button
              key={option}
              type="button"
              className="rm-choice__option"
              aria-pressed={selected}
              data-selected={selected}
              data-testid={`select-${id}-option-${option}`}
              onClick={() => handleClick(option)}
            >
              {option}
            </button>
          );
        })}
      </div>
    </div>
  );
}
