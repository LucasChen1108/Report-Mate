# src/components/

Shared, reusable UI pieces used across pages (buttons, inputs, field renderers,
layout shells, modals, etc.).

## Notes

- Keep these presentational and reusable — page-specific logic stays in `pages/`.
- Field renderers here should map one-to-one to the template schema's field types
  (text, number, select, checklist, photo) so the same components serve both the
  TemplateBuilder preview and the ReportEditor fill screen.
- Everything must honor the mobile-first, high-contrast, large-tap-target rules
  from `src/styles/`.
