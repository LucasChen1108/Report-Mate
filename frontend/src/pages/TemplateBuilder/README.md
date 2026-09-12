# pages/TemplateBuilder/

Dispatcher/admin-facing drag-and-drop editor for building and customizing report
templates. Dispatcher-only route.

## What it does

- A field-type palette (text, number, select, checklist, photo) that can be
  dragged in and reordered — built on an existing DnD library (e.g. dnd-kit),
  not a hand-rolled canvas.
- Organize fields into ordered sections; mark fields `required` / optional.
- Save / edit / list custom templates via `src/api/` (`report_templates` CRUD).
- Produces the template **schema JSON** — the ordered sections → typed fields →
  required-flag shape that is the single contract shared with the report
  renderer and the agent's `get_template_schema` tool.

## Notes

- Get the schema shape right early: the agent fills blanks *defined by this
  schema*, so changes to its shape should be rare and deliberate.
- Ship 2–3 seed templates for the demo and for the team to test against.

Owner: Letao & Aaron (template engine + rendering/export). Agree the schema
format together on day 1 before splitting.
