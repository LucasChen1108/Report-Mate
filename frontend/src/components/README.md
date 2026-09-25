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

## Authentication-aware routing

- `RequireAuth` blocks protected route outlets until session restoration has
  completed, then redirects signed-out visitors to Login with a validated
  internal return destination.
- `RequireRole` reads the canonical user from `AuthProvider` and redirects
  cross-role visits declaratively. It never navigates during render through a
  callback.
- `PublicOnlyRoute` prevents authenticated users from remaining on Login or
  Registration and respects a safe, role-authorized return destination.
- These frontend guards are navigation and user-experience controls only. The
  backend remains responsible for authoritative authentication and
  authorization.
