// Package templates owns report template CRUD and schema validation.
//
// A template is stored as JSON in report_templates.schema: an ordered list of
// sections, each with typed fields (text, number, select, checklist, photo)
// and a `required` flag.
//
// Responsibilities (to implement):
//   - CRUD over report_templates (create / edit / list custom templates).
//   - Validate an incoming template schema (well-formed sections/fields,
//     known field types, sane required flags) before persisting.
//   - Expose the schema for a given template id — consumed by the report
//     renderer AND by the agent's get_template_schema tool.
//   - Seed 2–3 demo templates for the demo and for the team to test against.
//
// The template schema shape is the single contract shared by the builder UI,
// the report renderer, and the agent. Changes to its shape should be rare and
// deliberate.
package templates
