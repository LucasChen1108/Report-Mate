# Implementation Plan: Template Builder

## Overview

This plan implements the Template Builder as three coordinated surfaces: the shared **Template Schema** contract (mirrored as a TypeScript type and a Go struct), the **Go backend** (`backend/internal/templates/` store, validator, HTTP handlers; RBAC middleware; an additive migration; seed templates), and the **React + TypeScript frontend** (`frontend/src/pages/TemplateBuilder/`) built on dnd-kit with a pure `builderReducer`.

The build order defines the shared contract first, then the backend validator/store/handlers, then the frontend scaffold and reducer, then the dnd-kit UI, and finally wiring and integration. Testing follows the design's dual approach: 19 property-based tests (rapid on Go, fast-check on the frontend), plus example, integration, and structural checks. Each property test runs at least 100 iterations and is tagged `Feature: template-builder, Property {n}: {text}`.

The Go module exists at `backend/go.mod`. The frontend has no `package.json` yet, so an early task stands up a Vite React + TypeScript project and adds dnd-kit and fast-check.

## Tasks

- [x] 1. Establish the shared Template Schema contract
  - [x] 1.1 Define the shared TypeScript schema type
    - Create `frontend/src/api/types.ts` with the `FieldType` six-literal union (`text`, `number`, `select`, `checklist`, `photo`, `signature`), `OptionFieldType`, `BasicField`, `OptionField`, `Field`, `Section`, `TemplateSchema` (with `version: 1`), and the `hasOptions` narrowing helper
    - Model `options` as reachable only on `select`/`checklist` via the discriminated union so `signature`/`text`/`number`/`photo` cannot carry options at the type level
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6, 1.10_

  - [x] 1.2 Define the Go schema representation
    - Create `backend/internal/templates/schema.go` with `FieldType` constants for all six types, `known()` and `carriesOptions()` methods, and `Field`, `Section`, `TemplateSchema` structs with JSON tags (`options,omitempty`)
    - _Requirements: 1.2, 1.3, 1.4, 1.5, 1.6_

  - [ ]* 1.3 Write shared-type compile-time assertion test
    - Assert `FieldType` is exactly the six literals and a sample schema type-checks against `TemplateSchema`
    - _Requirements: 1.10_

- [x] 2. Implement the backend schema validator
  - [x] 2.1 Implement `Validate` and `ValidationError`
    - In `backend/internal/templates/`, implement `func Validate(schema TemplateSchema) error` and the `ValidationError` struct (`Field`, `Element`, `Message`) with `Error()`
    - Enforce every Requirement 1 rule: section count 1–50, field count 0–100 per section, known type, field id non-empty 1–64 chars and unique across the template, section/field labels non-empty (trimmed) 1–120 chars, `select`/`checklist` options 1–50 unique values, no stray options on non-option types
    - Return the first `*ValidationError` naming the offending element (id, or a structural marker for section-count); return `nil` when valid
    - _Requirements: 1.1, 1.2, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.11, 1.12, 1.13_

  - [ ]* 2.2 Write property test for validator totality
    - **Property 1: Validator totality** (`Validate` returns nil iff the schema satisfies every Req 1 rule; a single injected violation yields a `ValidationError`)
    - Use rapid; minimum 100 iterations; tag `Feature: template-builder, Property 1: Validator totality`
    - **Validates: Requirements 1.7, 1.3**

  - [ ]* 2.3 Write property test for bounds and identifier uniqueness naming the offender
    - **Property 2: Bounds and identifier uniqueness are enforced, and the offending element is named**
    - Single out-of-bounds mutation (section/field counts, label length, id length, duplicate id) is rejected with the offending element identified
    - Use rapid; minimum 100 iterations; tag `Feature: template-builder, Property 2: Bounds and identifier uniqueness are enforced, and the offending element is named`
    - **Validates: Requirements 1.1, 1.4, 1.5, 1.11, 1.12**

  - [ ]* 2.4 Write property test for unknown field type rejection
    - **Property 3: Unknown field types are rejected and named** (replacing one field's `type` with any out-of-union string is rejected, error names that field's id)
    - Use rapid; minimum 100 iterations; tag `Feature: template-builder, Property 3: Unknown field types are rejected and named`
    - **Validates: Requirements 1.2, 1.8**

  - [ ]* 2.5 Write property test for option-list validity
    - **Property 4: Option-list validity for select and checklist** (option-carrying fields valid iff 1–50 unique options; non-option fields valid only with no options; any violation rejected naming the field id)
    - Use rapid; minimum 100 iterations; tag `Feature: template-builder, Property 4: Option-list validity for select and checklist`
    - **Validates: Requirements 1.6, 1.9, 1.13**

  - [ ]* 2.6 Write example test for non-boolean `required` decode rejection
    - A body whose `required` is non-boolean fails to decode into `TemplateSchema` (400-level, validation not attempted)
    - _Requirements: 1.3_

- [x] 3. Implement the database migration and store
  - [x] 3.1 Add the `report_templates` migration
    - Create a new ordered migration file in `backend/db/migrations/` (numeric prefix following the last applied migration) creating `report_templates` (`id` UUID PK, `name` TEXT non-empty CHECK, `schema` JSONB NOT NULL, `is_seed` BOOLEAN default false, `created_at`/`updated_at` TIMESTAMPTZ) plus `idx_report_templates_updated_at`
    - Additive only; do not edit any applied migration
    - _Requirements: 5.1, 5.5, 7.3_

  - [x] 3.2 Implement the `Store` interface and CRUD
    - In `backend/internal/templates/`, define the `Store` interface (`List`, `Get`, `Create`, `Update`) returning `TemplateSummary` / `TemplateRecord`, and implement it against PostgreSQL with `schema` marshaled to/from jsonb
    - `Get`/`Update` on an unknown id surface a not-found condition
    - _Requirements: 5.1, 5.2, 5.3, 5.4_

  - [ ]* 3.3 Write property test for persistence round-trip
    - **Property 17: Persistence round-trip preserves the schema** (create → get deep-equals saved; update → get deep-equals update)
    - Run against a test database or a contract-honoring store double; use rapid; minimum 100 iterations; tag `Feature: template-builder, Property 17: Persistence round-trip preserves the schema`
    - **Validates: Requirements 5.2, 5.3**

- [x] 4. Implement RBAC middleware and HTTP handlers
  - [x] 4.1 Implement `RequireRole` RBAC middleware
    - In `backend/internal/middleware/`, implement `RequireRole("dispatcher_admin")` reading the authenticated role from request context and returning `403` with an authorization error when the role is absent
    - _Requirements: 6.1, 6.3_

  - [x] 4.2 Implement the templates HTTP handlers and routes
    - In `backend/internal/templates/`, add handlers for `GET /api/templates`, `GET /api/templates/{id}`, `POST /api/templates`, `PUT /api/templates/{id}`
    - Decode body into `TemplateSchema`, call `Validate`, and only on success call the `Store`; on validation failure return `422` with `{code, message, elementId}` and never touch the store
    - Map decode failures to `400`, unknown id to `404`, store errors to `500` (generic message, logged server-side)
    - Mount `POST`/`PUT` behind the dispatcher-admin RBAC middleware; leave `GET` routes ungated by role
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 6.3, 1.8, 1.9, 1.11, 1.12, 1.13_

  - [ ]* 4.3 Write property test for write-access restriction
    - **Property 18: Write access is restricted to dispatcher-admins** (write succeeds only for dispatcher-admin; every other role gets an authorization error and no record change)
    - Use rapid; minimum 100 iterations; tag `Feature: template-builder, Property 18: Write access is restricted to dispatcher-admins`
    - **Validates: Requirements 6.1**

  - [ ]* 4.4 Write structural checks for RBAC coverage and route wiring
    - Router-table inspection confirms each write route sits behind the dispatcher-admin middleware
    - _Requirements: 6.3_

- [x] 5. Provide seed templates
  - [x] 5.1 Author and insert 2–3 seed templates
    - Add a seed migration or seed script inserting HVAC Service Visit, General Maintenance Report, and Safety Inspection with `is_seed = TRUE`, collectively exercising all six field types
    - Run each seed schema through `Validate` before insert so a broken seed fails setup loudly
    - _Requirements: 7.1, 7.2, 7.3_

  - [ ]* 5.2 Write property test for seed-template conformance
    - **Property 19: Seed templates conform to the schema contract** (`Validate` returns nil for every shipped seed)
    - Use rapid; minimum 100 iterations over the seed set; tag `Feature: template-builder, Property 19: Seed templates conform to the schema contract`
    - **Validates: Requirements 7.2**

- [ ] 6. Checkpoint - backend complete
  - Ensure all backend tests pass, ask the user if questions arise.

- [x] 7. Scaffold the frontend project and API client
  - [x] 7.1 Set up the Vite React + TypeScript project
    - Initialize a Vite React + TypeScript project rooted at `frontend/` (create `package.json`, `tsconfig`, `vite.config`, entry files) and add dependencies: `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities`, and dev dependencies `vitest` and `fast-check`
    - Configure Vitest so property and unit tests can run
    - _Requirements: 2.7_

  - [x] 7.2 Implement the typed API client
    - Create `frontend/src/api/templates.ts` exporting `TemplateSummary`, `TemplateRecord`, `ValidationError`, and `listTemplates`, `getTemplate`, `createTemplate`, `updateTemplate`, all typed against the shared `TemplateSchema`
    - Surface `422` and `403` responses as typed rejections; this client is the only backend path (no scattered `fetch`)
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.7_

- [x] 8. Implement the pure builder reducer
  - [x] 8.1 Implement `builderReducer` and `BuilderAction`
    - Create the reducer module under `frontend/src/pages/TemplateBuilder/` implementing all `BuilderAction` kinds (`addSection`, `renameSection`, `reorderSections`, `removeSection`, `addField`, `moveField`, `reorderField`, `removeField`, `renameField`, `setRequired`, `addOption`, `editOption`, `removeOption`) as pure, non-mutating transforms
    - `addField` assigns a client-generated template-unique id, `required: false`, and a non-empty default label derived from the type; `addSection` appends last; option removal keeps the last option
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 3.1, 3.4, 3.5, 3.6, 3.7, 3.9, 4.1, 4.3, 4.4, 4.5, 4.6, 4.8_

  - [ ]* 8.2 Write property test for identifier stability across edits
    - **Property 5: Field identifiers are stable across edits** (any sequence of non-add actions preserves every pre-existing field id)
    - Use fast-check with Vitest; minimum 100 iterations; tag `Feature: template-builder, Property 5: Field identifiers are stable across edits`
    - **Validates: Requirements 1.4**

  - [ ]* 8.3 Write property test for add-field insertion
    - **Property 6: Adding a field inserts a typed field at the drop position**
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 6: Adding a field inserts a typed field at the drop position`
    - **Validates: Requirements 2.2**

  - [ ]* 8.4 Write property test for unique added-field identifiers
    - **Property 7: Added fields have identifiers unique within the template** (any sequence of `addField` keeps all field ids pairwise distinct)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 7: Added fields have identifiers unique within the template`
    - **Validates: Requirements 2.3**

  - [ ]* 8.5 Write property test for safe field defaults
    - **Property 8: Added fields carry safe defaults** (`required` is false and label is a non-empty string)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 8: Added fields carry safe defaults`
    - **Validates: Requirements 2.4, 2.5**

  - [ ]* 8.6 Write property test for section append
    - **Property 9: Adding a section appends it last** (one more section as last entry; prior sections unchanged and in order)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 9: Adding a section appends it last`
    - **Validates: Requirements 3.1**

  - [ ]* 8.7 Write property test for section reorder permutation
    - **Property 10: Reordering sections is a permutation** (same multiset of sections; moved section at target position)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 10: Reordering sections is a permutation`
    - **Validates: Requirements 3.4**

  - [ ]* 8.8 Write property test for in-section field reorder
    - **Property 11: Reordering fields within a section is a local permutation** (that section's fields permuted; every other section byte-for-byte unchanged)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 11: Reordering fields within a section is a local permutation`
    - **Validates: Requirements 3.5**

  - [ ]* 8.9 Write property test for cross-section move
    - **Property 12: Moving a field preserves the total field multiset** (removed from source, inserted at target index, sole field when target empty; total field multiset unchanged)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 12: Moving a field preserves the total field multiset`
    - **Validates: Requirements 3.6**

  - [ ]* 8.10 Write property test for field removal
    - **Property 13: Removing a field deletes exactly that field** (id gone, one fewer field total, every other field unchanged)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 13: Removing a field deletes exactly that field`
    - **Validates: Requirements 3.7**

  - [ ]* 8.11 Write property test for section removal
    - **Property 14: Removing a section deletes that section and only its fields** (remaining sections and their fields unchanged)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 14: Removing a section deletes that section and only its fields`
    - **Validates: Requirements 3.9**

  - [ ]* 8.12 Write property test for label/required edits locality
    - **Property 15: Label and required edits change only the target element** (`renameField`/`renameSection`/`setRequired` mutate only the target; all else unchanged)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 15: Label and required edits change only the target element`
    - **Validates: Requirements 4.1, 4.3, 4.8**

  - [ ]* 8.13 Write property test for option edit locality
    - **Property 16: Option edits mutate only the target field's option list** (`addOption` +1, `editOption` replaces one entry, `removeOption` −1 when length > 1; no other field/section changes)
    - Use fast-check; minimum 100 iterations; tag `Feature: template-builder, Property 16: Option edits mutate only the target field's option list`
    - **Validates: Requirements 4.4, 4.5, 4.6**

- [ ] 9. Checkpoint - contract and reducer proven
  - Ensure all backend and reducer tests pass, ask the user if questions arise.

- [x] 10. Build the dnd-kit editor UI
  - [x] 10.1 Implement TemplateBuilderPage, DndContext, and FieldPalette
    - Create `TemplateBuilderPage` owning a single `DndContext` and the working `TemplateSchema` state driven by `builderReducer`; owns template name and dirty tracking
    - Create `FieldPalette` rendering exactly one draggable block per `Field_Type` (six blocks), each carrying `{ source: "palette", type }`
    - Configure sensors with an activation constraint so taps on controls are not hijacked
    - _Requirements: 2.1, 2.7_

  - [x] 10.2 Implement SectionList, SectionCard, FieldList, and FieldCard with dnd wiring
    - Sections as a vertical `SortableContext`; each `SectionCard` sortable and a droppable field area; fields as a nested `SortableContext`
    - Wire `onDragEnd` branching on the drag-data discriminant (`palette`/`field`/`section`) to dispatch `addField` (palette → section at drop index), `reorderField` (same section), `moveField` (cross-section, empty target places as sole field), and `reorderSections`; a release outside any section dispatches nothing
    - _Requirements: 2.2, 2.6, 2.7, 3.4, 3.5, 3.6_

  - [x] 10.3 Implement section add/delete flows
    - Add-section requests a 1–100 char label; whitespace-only labels are rejected with a "section label is required" message
    - Deleting a non-empty section requires confirmation via a large-tap-target `ConfirmDialog` and deletes only after confirm; deletion removes the section and all its fields
    - _Requirements: 3.1, 3.2, 3.3, 3.8, 3.9_

  - [x] 10.4 Implement FieldPropertyEditor and OptionListEditor
    - Edit field label (reject empty/whitespace, retain previous, show "label is required"), toggle required flag, and edit section label (same rejection behavior)
    - `OptionListEditor` renders only for `select`/`checklist`: add/edit/remove options; block removing the last option with "at least one option is required"
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9_

  - [ ]* 10.5 Write example tests for editor flows
    - Palette renders six blocks (Req 2.1); drop-outside dispatches no action (Req 2.6); add-section label flow and whitespace rejection (Req 3.2, 3.3); section-delete confirmation (Req 3.8); last-option removal blocked (Req 4.7); whitespace label edits rejected and previous retained (Req 4.2, 4.9)
    - _Requirements: 2.1, 2.6, 3.2, 3.3, 3.8, 4.2, 4.7, 4.9_

- [x] 11. Implement save/edit/list flows and the route guard
  - [x] 11.1 Implement SaveBar and save/update flow
    - Create `SaveBar` with a template name input and save action; block save on empty name with a "template name is required" message
    - On save call `createTemplate`/`updateTemplate` through the API client; on failure retain all unsaved edits and surface the error, highlighting the offending element via `elementId` for a 422
    - _Requirements: 5.1, 5.3, 5.5, 5.6, 5.7_

  - [x] 11.2 Implement TemplateListPage and open flow
    - Create `TemplateListPage` retrieving templates through the API client and displaying seed and custom templates; opening a template loads its schema into the editor
    - _Requirements: 5.2, 5.4, 7.3_

  - [x] 11.3 Implement the frontend RBAC route guard
    - Guard the Template Builder route so a non-dispatcher-admin is redirected/blocked; the backend RBAC check remains authoritative
    - _Requirements: 6.2_

  - [ ]* 11.4 Write integration tests for template flows
    - Create/list/open/update through the real API client against a test backend (Req 5.1, 5.2, 5.3, 5.4); seed display returns seeds plus a custom template (Req 7.3); RBAC on live routes — dispatcher-admin write succeeds, technician write returns 403
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 6.1, 7.3_

  - [ ]* 11.5 Write route-guard and no-scattered-fetch checks
    - Route guard blocks non-dispatcher-admins and allows dispatcher-admins (Req 6.2); lint/grep check confirms `TemplateBuilder` makes only API-client calls, no direct `fetch` (Req 5.7)
    - _Requirements: 5.7, 6.2_

- [x] 12. Apply mobile-first, high-contrast styling
  - [ ] 12.1 Implement responsive, high-contrast, large-tap-target styles
    - Style the builder for mobile viewport widths; interactive controls at least 44×44 CSS px; text/controls at ≥4.5:1 contrast; choice controls rendered as large tap-target components rather than native dropdowns
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

  - [ ]* 12.2 Write mobile-first/accessibility checks
    - Computed tap-target size ≥44×44 px (Req 8.2); theme color pairs meet 4.5:1 (Req 8.3); choice controls are large tap-target components, not native `select` (Req 8.4); builder renders/adapts at mobile widths (Req 8.1). Full WCAG conformance requires manual testing with assistive technologies and expert review beyond these automated checks.
    - _Requirements: 8.1, 8.2, 8.3, 8.4_

- [ ] 13. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; core implementation tasks are never optional.
- Each task references specific requirement clauses for traceability.
- Checkpoints ensure incremental validation at the backend, contract/reducer, and final boundaries.
- The 19 correctness properties are each implemented by a single property-based test running at least 100 iterations, tagged `Feature: template-builder, Property {n}: {text}` — Properties 1–4, 17, 18, 19 on the Go backend (rapid), Properties 5–16 on the frontend (fast-check).
- The `Field_Type` union has six members; `signature` is a distinct capture type treated like the other non-option types (no options list). Only `select`/`checklist` carry options.
- The schema contract is defined once and mirrored: `frontend/src/api/types.ts` (compiler-enforced) and `backend/internal/templates/schema.go` (enforced by `Validate`, the authoritative source of truth).

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "1.2", "3.1", "4.1"] },
    { "id": 1, "tasks": ["1.3", "2.1", "7.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "2.4", "2.5", "2.6", "3.2", "7.2", "8.1"] },
    { "id": 3, "tasks": ["3.3", "4.2", "5.1", "8.2", "8.3", "8.4", "8.5", "8.6", "8.7", "8.8", "8.9", "8.10", "8.11", "8.12", "8.13"] },
    { "id": 4, "tasks": ["4.3", "4.4", "5.2", "10.1"] },
    { "id": 5, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 6, "tasks": ["10.5", "11.1", "11.2", "11.3", "12.1"] },
    { "id": 7, "tasks": ["11.4", "11.5", "12.2"] }
  ]
}
```
