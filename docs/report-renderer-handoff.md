# Report Renderer — handoff notes (from the Template Builder work)

For Aaron, who owns the **Report Renderer** (manual + agent-assisted fill).
This captures what's already built that the renderer depends on, plus three
decisions we made while researching real-world templates that affect the
renderer specifically. The Report Renderer is its own spec — this is just the
coordination surface between it and the Template Builder.

## The shared contract (already in the repo — build against this)

The template schema is the single source of truth shared by the builder, the
renderer, and the agent's `get_template_schema` tool. Do **not** redefine it;
import/mirror these:

- **`frontend/src/api/types.ts`** — the TypeScript `TemplateSchema`, `Section`,
  `Field`, and the `FieldType` union. The renderer maps each field type to an
  input control, so this is the type to build the fill UI against.
- **`backend/internal/templates/schema.go`** — the Go mirror of the same shape.
- **`backend/internal/templates/validate.go`** — the authoritative validation
  rules (the backend is the source of truth; the frontend does UX-level checks).
- **`frontend/src/api/templates.ts`** — the typed API client (`listTemplates`,
  `getTemplate`, `createTemplate`, `updateTemplate`). All backend calls go
  through this client — no scattered `fetch`.

### The six field types

`text`, `number`, `select`, `checklist`, `photo`, `signature`.

- `signature` is a distinct capture type (a signature pad), added because
  100% of the real templates we checked (SafetyCulture, ServiceTitan, GoAudits,
  Appenate) include a distinct sign-off capture. Render it as a signature pad,
  not a text box.
- Only `select` and `checklist` carry an `options` list. `text`, `number`,
  `photo`, and `signature` have no options.

## Three renderer-specific decisions (NOT in the template schema)

These came out of the real-world template research. They are **render-time /
data-model concerns**, deliberately kept out of the template schema so the
schema stays the clean shared contract. Fold these into the Report Renderer
spec:

1. **Photo captions.** Real templates show "before/after photos with
   annotations" — a photo naturally carries an optional caption when filled in.
   This is NOT a schema change (photo stays one field type). At fill time, the
   renderer should offer an optional caption text box alongside the photo
   upload — not a second separate field.

2. **Parts / materials used.** Every real template has a parts-used table
   (part, part number, quantity) as its own structural section. We already have
   a dedicated `parts_used` table in the data model, separate from the template
   schema. So there is NO new repeatable-list field type. The renderer should
   surface a "Parts Used" section backed by that table directly, rather than
   treating it as a generic template field.

3. **Signature at fill time.** The builder now emits `signature` fields; the
   renderer needs a matching signature-capture control on the fill side (and it
   participates in the human-in-the-loop review before submit like any other
   field).

## Seed templates to test against

`backend/internal/templates/seeds.go` (and migration
`0004_seed_report_templates.sql`) ship three validated seed templates —
HVAC Service Visit, General Maintenance Report, Safety Inspection — that
collectively exercise all six field types. Use these to develop the renderer
without hand-building a template first.

## Status of the Template Builder

Implementation is complete and compiles/builds clean (Go backend + React/TS
frontend). The optional property-based tests (the 19 correctness properties in
the design) are written up in the spec's `tasks.md` but not yet implemented —
they're the remaining work on the builder side.
