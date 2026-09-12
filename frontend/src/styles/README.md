# src/styles/

The mobile-first, high-contrast theme — the one place field-conditions UI rules
live.

## Design rules to encode here

- **Big tap targets** — comfortably usable one-handed, gloves-on friendly.
- **High contrast** — legible in outdoor sun.
- **No tiny dropdowns / small controls** — prefer large, obvious inputs.
- Responsive, mobile-first breakpoints (phone is the primary target; dispatcher
  desktop views scale up from there).

## Notes

- Centralize tokens (colors, spacing, font sizes, min tap-target size) here so a
  Kiro hook can enforce contrast/tap-target rules automatically.
- Components in `src/components/` consume these tokens rather than hardcoding
  their own values.
