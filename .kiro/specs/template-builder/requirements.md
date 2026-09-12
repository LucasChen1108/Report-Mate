# Requirements Document

## Introduction

The Template Builder is a dispatcher/admin-facing, drag-and-drop block editor for creating and customizing report templates in Report Mate (a mobile-first service-report app). A dispatcher drags typed field blocks (text, number, select, checklist, photo, signature) into ordered sections, marks each field required or optional, and saves, edits, and lists custom templates.

The editor produces a **Template Schema** — an ordered list of sections, each containing typed fields with a `required` flag — stored as JSON in `report_templates.schema`. This schema is the single shared contract consumed by three parties: this Template Builder UI, the Report Renderer (manual and agent-assisted fill), and the AI agent's `get_template_schema` tool. Because the schema shape is a shared contract, its structure is the most important part of this feature; changes to its shape are expected to be rare and deliberate.

The drag-and-drop mechanics are built on the team's chosen library (dnd-kit) rather than a custom canvas/undo-redo editor. The feature is dispatcher-admin only (RBAC gated), all backend access goes through the typed API client in `frontend/src/api/`, and the backend (Go) exposes `report_templates` CRUD plus schema validation. The team ships 2–3 seed templates for the demo and for teammates to test against.

## Glossary

- **Template_Builder**: The React + TypeScript, dispatcher/admin-facing UI (at `frontend/src/pages/TemplateBuilder/`) for authoring report templates.
- **Template_Service**: The Go backend component (at `backend/internal/templates/`) that owns `report_templates` CRUD and Template Schema validation.
- **API_Client**: The typed frontend client at `frontend/src/api/` through which all backend calls are made.
- **Template_Schema**: The JSON structure stored in `report_templates.schema` — an ordered list of sections, each containing an ordered list of typed fields, each field carrying a `required` flag. The single contract shared by the Template Builder, Report Renderer, and agent.
- **Section**: A named, ordered grouping of fields within a Template Schema.
- **Field**: A single typed input within a section, having a type, a label, a stable identifier, and a `required` flag.
- **Field_Type**: One of the supported field types: `text`, `number`, `select`, `checklist`, `photo`, `signature`.
- **Field_Palette**: The set of draggable Field_Type blocks the dispatcher drags into sections.
- **Required_Flag**: A boolean on each Field indicating whether the field must be filled before a report is submitted.
- **Dispatcher_Admin**: A user with the dispatcher/admin role, authorized to use the Template Builder.
- **Technician**: A field user who fills reports; not authorized to use the Template Builder.
- **RBAC**: Role-based access control enforced by backend middleware and the frontend route guard.
- **Seed_Template**: A pre-built Template stored at setup time for the demo and for team testing (2–3 total).
- **Report_Renderer**: The separate feature (owned by Aaron) that renders a Template Schema for manual and agent-assisted fill.

## Requirements

### Requirement 1: Define and validate the Template Schema contract

**User Story:** As a Dispatcher_Admin, I want a well-defined and validated template schema, so that the templates I build reliably drive both the report renderer and the AI agent.

#### Acceptance Criteria

1. THE Template_Schema SHALL represent a template as an ordered list of 1 to 50 sections, where each section contains an ordered list of 0 to 100 fields.
2. THE Template_Schema SHALL assign each Field a Field_Type that is one of: `text`, `number`, `select`, `checklist`, `photo`, `signature`.
3. THE Template_Schema SHALL assign each Field a Required_Flag with a boolean value.
4. THE Template_Schema SHALL assign each Field a stable identifier that is unique within the template and is a non-empty string of 1 to 64 characters that does not change across edits to the Field.
5. THE Template_Schema SHALL assign each Section and each Field a label that is a non-empty string of 1 to 120 characters.
6. WHERE a Field has Field_Type `select` or `checklist`, THE Template_Schema SHALL include a list of 1 to 50 selectable options for that Field, where each option value is unique within that Field.
7. WHEN the Template_Service receives a Template_Schema for persistence, THE Template_Service SHALL validate that every Field has a known Field_Type, a unique identifier within the template, a non-empty label, and a boolean Required_Flag before persisting.
8. IF a submitted Template_Schema contains a Field with an unrecognized Field_Type, THEN THE Template_Service SHALL reject the request without persisting any change and return a validation error identifying the offending Field by its identifier.
9. IF a submitted Template_Schema contains a `select` or `checklist` Field with an empty or missing option list, THEN THE Template_Service SHALL reject the request without persisting any change and return a validation error identifying the offending Field by its identifier.
10. THE API_Client SHALL expose a shared TypeScript type mirroring the Template_Schema shape, including the Field_Type union of `text`, `number`, `select`, `checklist`, `photo`, and `signature`, so the Template_Builder and Report_Renderer reference one definition.
11. IF a submitted Template_Schema contains zero sections, or contains a Section whose field count or a Field, Section, option, or identifier value falls outside the bounds defined in this requirement, THEN THE Template_Service SHALL reject the request without persisting any change and return a validation error identifying the offending element.
12. IF a submitted Template_Schema contains a Section or Field with a missing or empty label, THEN THE Template_Service SHALL reject the request without persisting any change and return a validation error identifying the offending Section or Field.
13. IF a submitted Template_Schema contains a `select` or `checklist` Field with duplicate option values within that Field, THEN THE Template_Service SHALL reject the request without persisting any change and return a validation error identifying the offending Field by its identifier.

### Requirement 2: Drag field blocks into sections

**User Story:** As a Dispatcher_Admin, I want to drag typed field blocks from a palette into sections, so that I can compose a template from reusable building blocks.

#### Acceptance Criteria

1. THE Template_Builder SHALL present a Field_Palette containing one draggable block per Field_Type: `text`, `number`, `select`, `checklist`, `photo`, `signature`.
2. WHEN a Dispatcher_Admin drops a Field_Palette block onto a Section, THE Template_Builder SHALL add a Field of the corresponding Field_Type to that Section at the drop position within that Section's ordered field list.
3. WHEN a Field is added to a Section, THE Template_Builder SHALL assign the new Field a stable identifier that is unique within the template.
4. WHEN a Field is added to a Section, THE Template_Builder SHALL set the new Field Required_Flag to `false` by default.
5. WHEN a Field is added to a Section, THE Template_Builder SHALL assign the new Field a non-empty default label that the Dispatcher_Admin can subsequently edit.
6. IF a Dispatcher_Admin releases a dragged Field_Palette block outside any Section, THEN THE Template_Builder SHALL not add a Field and SHALL leave the Template_Schema unchanged.
7. THE Template_Builder SHALL implement drag-and-drop interactions using the dnd-kit library.

### Requirement 3: Organize fields and sections into an order

**User Story:** As a Dispatcher_Admin, I want to add sections and reorder sections and fields, so that the report follows the sequence technicians work through.

#### Acceptance Criteria

1. WHEN a Dispatcher_Admin adds a Section, THE Template_Builder SHALL append the new Section as the last entry in the ordered list of sections in the Template_Schema.
2. WHEN a Dispatcher_Admin adds a Section, THE Template_Builder SHALL request a Section label of 1 to 100 characters for the new Section.
3. IF a Dispatcher_Admin confirms a new Section with a Section label that is empty or contains only whitespace, THEN THE Template_Builder SHALL reject the label and display a message that a Section label is required.
4. WHEN a Dispatcher_Admin reorders the sections, THE Template_Builder SHALL update the section order in the Template_Schema to match the new arrangement.
5. WHEN a Dispatcher_Admin reorders the fields within a Section, THE Template_Builder SHALL update the field order within that Section in the Template_Schema to match the new arrangement.
6. WHEN a Dispatcher_Admin moves a Field from a source Section to a target Section, THE Template_Builder SHALL remove the Field from the source Section and insert the Field into the target Section at the drop position, where the drop position at the end of an empty target Section places the Field as that Section's only Field.
7. WHEN a Dispatcher_Admin removes a Field, THE Template_Builder SHALL delete that Field from its Section in the Template_Schema.
8. IF a Dispatcher_Admin requests removal of a Section that contains one or more Fields, THEN THE Template_Builder SHALL request confirmation before deleting the Section, and SHALL delete the Section only after the Dispatcher_Admin confirms.
9. WHEN a Dispatcher_Admin confirms removal of a Section, THE Template_Builder SHALL delete that Section and all Fields it contains from the Template_Schema.

### Requirement 4: Edit field properties

**User Story:** As a Dispatcher_Admin, I want to edit each field's label, required flag, and options, so that the template captures exactly the information a report needs.

#### Acceptance Criteria

1. WHEN a Dispatcher_Admin commits a non-empty Field label, THE Template_Builder SHALL update that Field label in the Template_Schema.
2. IF a Dispatcher_Admin commits an empty or whitespace-only Field label, THEN THE Template_Builder SHALL reject the change, retain the previous Field label in the Template_Schema, and display a message indicating that a label is required.
3. WHEN a Dispatcher_Admin toggles a Field Required_Flag, THE Template_Builder SHALL set that Field Required_Flag to the selected boolean value.
4. WHERE a Field has Field_Type `select` or `checklist`, WHEN a Dispatcher_Admin adds a selectable option, THE Template_Builder SHALL append the new option to that Field's option list in the Template_Schema.
5. WHERE a Field has Field_Type `select` or `checklist`, WHEN a Dispatcher_Admin edits a selectable option, THE Template_Builder SHALL update that option in the Field's option list in the Template_Schema.
6. WHERE a Field has Field_Type `select` or `checklist` and the Field's option list contains more than one option, WHEN a Dispatcher_Admin removes a selectable option, THE Template_Builder SHALL remove that option from the Field's option list in the Template_Schema.
7. WHERE a Field has Field_Type `select` or `checklist` and the Field's option list contains exactly one option, IF a Dispatcher_Admin attempts to remove that option, THEN THE Template_Builder SHALL block the removal, retain the existing option in the Template_Schema, and display a message indicating that at least one option is required.
8. WHEN a Dispatcher_Admin commits a non-empty Section label, THE Template_Builder SHALL update that Section label in the Template_Schema.
9. IF a Dispatcher_Admin commits an empty or whitespace-only Section label, THEN THE Template_Builder SHALL reject the change, retain the previous Section label in the Template_Schema, and display a message indicating that a label is required.

### Requirement 5: Save, edit, and list custom templates

**User Story:** As a Dispatcher_Admin, I want to save, reopen, and list templates, so that I can manage report templates over time.

#### Acceptance Criteria

1. WHEN a Dispatcher_Admin saves a new template, THE Template_Builder SHALL send the template name and Template_Schema to the Template_Service through the API_Client and create a `report_templates` record.
2. WHEN a Dispatcher_Admin opens an existing template, THE Template_Builder SHALL load that template Template_Schema from the Template_Service through the API_Client into the editor.
3. WHEN a Dispatcher_Admin saves changes to an existing template, THE Template_Builder SHALL send the updated Template_Schema to the Template_Service through the API_Client and update the existing `report_templates` record.
4. WHEN a Dispatcher_Admin opens the template list, THE Template_Builder SHALL retrieve and display the list of saved templates from the Template_Service through the API_Client.
5. IF a Dispatcher_Admin attempts to save a template with an empty name, THEN THE Template_Builder SHALL block the save and display a message that a template name is required.
6. IF a save request to the Template_Service fails, THEN THE Template_Builder SHALL retain the unsaved edits in the editor and display an error message.
7. THE Template_Builder SHALL route every backend request through the API_Client rather than direct `fetch` calls.

### Requirement 6: Restrict the builder to dispatcher-admins

**User Story:** As a project owner, I want the template builder restricted to dispatcher-admins, so that technicians cannot alter the report structures they fill.

#### Acceptance Criteria

1. IF a user without the Dispatcher_Admin role requests a `report_templates` write operation, THEN THE Template_Service SHALL reject the request with an authorization error.
2. WHERE the requesting user lacks the Dispatcher_Admin role, THE Template_Builder SHALL prevent access to the Template Builder route.
3. THE Template_Service SHALL enforce the Dispatcher_Admin role through RBAC middleware on every `report_templates` write route.

### Requirement 7: Provide seed templates

**User Story:** As a team member preparing the demo, I want seed templates available, so that the renderer and agent can be tested against real templates without hand-building one first.

#### Acceptance Criteria

1. THE Template_Service SHALL provide between two and three Seed_Templates at setup time.
2. THE Seed_Templates SHALL each conform to the validated Template_Schema contract defined in Requirement 1.
3. WHEN a Dispatcher_Admin opens the template list, THE Template_Builder SHALL display the Seed_Templates alongside any custom templates.

### Requirement 8: Mobile-first, high-contrast editing interface

**User Story:** As a Dispatcher_Admin, I want a mobile-first, high-contrast interface with large controls, so that the builder is usable on a phone in field conditions.

#### Acceptance Criteria

1. THE Template_Builder SHALL render a layout that adapts to mobile viewport widths.
2. THE Template_Builder SHALL present interactive controls with tap targets of at least 44 by 44 CSS pixels.
3. THE Template_Builder SHALL present text and interactive controls at a contrast ratio of at least 4.5 to 1 against their background.
4. WHERE a control offers a choice among options, THE Template_Builder SHALL present the choice using large tap targets rather than a small native dropdown.
