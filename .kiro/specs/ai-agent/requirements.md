# Requirements Document

## Introduction

Report Mate's AI agent is the product's headline feature: it lets a field technician draft a service report by giving a rough, typed, free-text account of a visit instead of filling every field by hand. The agent reads the chosen template's schema, pulls in supporting context (the customer's job history and the parts catalog), fills the fields it can confidently fill, and flags the required fields it cannot. The technician always reviews and edits the result in the existing Report Editor before submitting. The agent drafts; the human stays the author of record.

This feature lives entirely in the backend `agent` package, which is the only code permitted to talk to the LLM gateway. It builds on existing, already-shipped machinery: the template schema (`internal/templates`), the report draft model and its content validator (`internal/reports`, where `ValidateContent` already enforces that only fields declared by the template schema may be written), and the Report Editor UI where a draft is reviewed. The agent does not create templates and does not free-generate reports; it fills blanks defined by a template's schema.

Three product principles bound every requirement below: **human-in-the-loop always** (no report reaches submitted without a human review step), **graceful degradation** (if the gateway is unavailable the technician can still fill the same template by hand), and **predictable over clever** (the agent fills defined fields and flags uncertainty, never improvising outside the template's structure).

### Known dependency gaps (flagged for design/planning)

Two agent tools depend on data that does not yet exist. These are prerequisites the design must account for; the agent MUST degrade gracefully when they are absent rather than failing the whole run:

- **`get_job_history`** reads `internal/jobs`, which is currently a stub — the `jobs` table has no seed data. Until job data exists, this tool returns an empty history.
- **`get_parts_catalog`** has no backing table — no `parts_catalog` table exists yet (`parts_used` is a different, per-report table). Until a catalog exists, this tool returns an empty catalog.

## Glossary

- **Agent**: The backend tool-calling loop in `backend/internal/agent` that prompts the LLM Gateway, parses its JSON tool-call replies, dispatches to real Go functions, and feeds results back until the draft is complete. The only component that talks to the gateway.
- **LLM_Gateway**: The organizer-provided, Bedrock-backed proxy (OpenAI-compatible and Ollama-compatible) reached at `LLM_GATEWAY_URL` via `POST /v1/chat/completions` with a bearer key. External to Report Mate.
- **Agent_Endpoint**: The Go backend HTTP route the frontend calls to run the agent against a report draft. Proxies to the gateway server-side; the gateway key never leaves the backend.
- **Tool_Call**: A single JSON instruction emitted by the model, of the form `{"tool":"<name>","...args}`, that the Agent parses and dispatches to a real Go function.
- **Agent_Tool**: One of the dispatchable backend functions: `get_template_schema`, `get_job_history`, `get_parts_catalog`, `fill_field`, `flag_missing_field`, `save_draft`.
- **Report_Draft**: An existing `service_reports` row with `content` (values keyed by field id, plus a Parts Used table), `filled_by` (`manual` | `agent` | `mixed`), and `status` (`draft` | `submitted` | `exported`). The agent writes into this model.
- **Template_Schema**: The ordered sections → typed fields (text, number, select, checklist, photo, signature), each with `required` and `allowMultiple` flags, that defines what a report contains. Owned by `internal/templates`.
- **Fillable_Field**: A field the agent is permitted to write: type text, number, select, or checklist. Photo and signature fields are excluded — those are captured by the human.
- **Content_Validator**: The existing `reports.ValidateContent` function, which rejects any value written to a field id not declared by the report's schema snapshot. The enforcement point for "the agent may only write template-defined fields."
- **Run_Log**: The persisted, ordered record of a single agent run — every tool call, its arguments, its result, and token usage — sufficient to replay or debug the run.
- **Technician**: A field user who supplies the free-text account and reviews/edits the resulting draft.

## Requirements

### Requirement 1: Draft a report from a free-text account

**User Story:** As a technician, I want to give the agent a rough typed account of a job and have it fill the report template, so that I do not have to fill every field by hand.

#### Acceptance Criteria

1. WHEN the Technician submits a free-text account of 1 to 10,000 characters for an existing Report_Draft whose `status` is `draft`, THE Agent SHALL run the tool-calling loop against that draft's Template_Schema and produce updated draft content.
2. WHEN the Agent completes a run, THE Agent SHALL persist the updated content to the Report_Draft through the Content_Validator, and the Content_Validator SHALL reject the write if any field value violates the Template_Schema, leaving the Report_Draft content unchanged.
3. WHEN the Agent persists updated content it has contributed to, THE Agent SHALL set the Report_Draft `filled_by` to `agent` WHERE the draft's prior `filled_by` was empty or `agent`, and to `mixed` WHERE the draft's prior `filled_by` was `manual` or `mixed`.
4. IF the free-text account is empty, contains only whitespace, or exceeds 10,000 characters, THEN THE Agent_Endpoint SHALL reject the request and return a validation error indicating the invalid input, without invoking the LLM_Gateway and without modifying the Report_Draft.
5. THE Agent SHALL fill only fields on the Report_Draft named by the request and SHALL NOT create a new report and SHALL NOT create or modify a Template_Schema.
6. IF the request names a Report_Draft that does not exist, THEN THE Agent_Endpoint SHALL reject the request and return a not-found error without invoking the LLM_Gateway.
7. IF the request names an existing Report_Draft whose `status` is not `draft`, THEN THE Agent_Endpoint SHALL reject the request and return a validation error indicating the report is not editable, without invoking the LLM_Gateway and without modifying the Report_Draft.

### Requirement 2: Restrict writes to fillable template fields

**User Story:** As a dispatcher-admin, I want the agent constrained to the template's own fields, so that it cannot introduce arbitrary or fabricated data.

#### Acceptance Criteria

1. WHEN the Agent issues a `fill_field` Tool_Call whose target field id is declared by the Report_Draft's Template_Schema and whose type is text, number, select, or checklist, THE Agent SHALL write the value to that Fillable_Field.
2. IF a `fill_field` Tool_Call names a field id not declared by the Template_Schema, THEN THE Agent SHALL reject the write, leave the Report_Draft content unchanged, and record the rejection with the offending field id in the Run_Log.
3. IF a `fill_field` Tool_Call targets a field of type photo or signature, THEN THE Agent SHALL reject the write, leave the Report_Draft content unchanged, and record the rejection with the field id and type in the Run_Log.
4. WHEN the Agent writes a value to a text or select Fillable_Field, THE Agent SHALL write the value as a single string, and WHEN it writes to a checklist Fillable_Field, THE Agent SHALL write the value as an array of strings each drawn from the field's declared options.
5. WHEN the Agent writes a value to a number Fillable_Field, THE Agent SHALL write a value that represents a number, and IF the proposed value cannot be interpreted as a number, THEN THE Agent SHALL reject the write, leave the field unchanged, and record the rejection in the Run_Log.
6. IF a `fill_field` Tool_Call targets a select or checklist field with any value not among the options declared for that field by the Template_Schema, THEN THE Agent SHALL reject the write, leave the field unchanged, and record the rejection with the field id and the disallowed value in the Run_Log.
7. WHEN the Agent persists updated content, THE Content_Validator SHALL reject any value keyed to a field id not declared by the Template_Schema.

### Requirement 3: Flag required fields the agent cannot fill

**User Story:** As a technician, I want the agent to flag required fields it is unsure about instead of guessing, so that I can trust the fields it did fill and know exactly what still needs my attention.

#### Acceptance Criteria

1. WHEN the Agent cannot confidently fill a required Fillable_Field from the available context, THE Agent SHALL issue a `flag_missing_field` Tool_Call for that field rather than writing a value.
2. WHEN the Agent completes a run, THE Agent_Endpoint SHALL return the set of flagged field ids to the frontend for display in the Report Editor.
3. THE Agent SHALL leave any flagged field unfilled in the persisted Report_Draft content.
4. WHERE a required field is of type photo or signature, THE Agent SHALL report that field as requiring human capture rather than attempting to fill it.

### Requirement 4: Human review before submission

**User Story:** As a technician, I want to always review and edit the agent's draft before it is submitted, so that I remain the author of record.

#### Acceptance Criteria

1. WHEN the Agent completes a run, THE Agent SHALL leave the Report_Draft `status` as `draft`.
2. THE Agent SHALL NOT set a Report_Draft `status` to `submitted` or `exported`.
3. WHEN the Agent-produced draft is returned to the frontend, THE Report Editor SHALL present the filled and flagged fields for the Technician to review and edit before submission.

### Requirement 5: Provide context from job history and parts catalog

**User Story:** As a technician, I want the agent to use the customer's past jobs and the real parts catalog, so that the draft is grounded in real data instead of invented details.

#### Acceptance Criteria

1. WHEN the Agent issues a `get_template_schema` Tool_Call for the Report_Draft's template, THE Agent SHALL return the sections, fields, field types, and required flags of that Template_Schema.
2. WHEN the Agent issues a `get_job_history` Tool_Call, THE Agent SHALL return the customer's past jobs available from `internal/jobs`.
3. IF no job history is available for the requested job, THEN THE Agent SHALL return an empty history and continue the run.
4. WHEN the Agent issues a `get_parts_catalog` Tool_Call, THE Agent SHALL return the available parts catalog entries.
5. IF no parts catalog is available, THEN THE Agent SHALL return an empty catalog and continue the run.

### Requirement 6: Manual tool-calling loop against the gateway

**User Story:** As a backend developer, I want a hand-rolled JSON tool-calling loop instead of native tool-calling, so that the agent works reliably against the current gateway build.

#### Acceptance Criteria

1. WHEN the Agent prompts the LLM_Gateway, THE Agent SHALL send the request to `POST {LLM_GATEWAY_URL}/v1/chat/completions` with an `Authorization: Bearer` header, the configured model, and a non-streaming request body.
2. WHEN the LLM_Gateway returns a response, THE Agent SHALL read the assistant message from `choices[0].message.content`.
3. WHEN the assistant message contains a JSON Tool_Call, THE Agent SHALL parse the JSON after stripping any surrounding code-fence markers, dispatch to the named Agent_Tool, and feed the tool result back into the next prompt.
4. THE Agent SHALL determine tool dispatch by parsing the assistant message content and SHALL NOT rely on the gateway's native tool-calling fields.
5. IF an assistant message cannot be parsed as a valid Tool_Call, THEN THE Agent SHALL record the parse failure in the Run_Log and terminate the run rather than dispatching an undefined tool.
6. THE Agent SHALL terminate a run when the model issues a `save_draft` Tool_Call, and IF a run reaches its configured maximum of 10 loop iterations without a `save_draft`, THEN THE Agent SHALL terminate the run and record reaching the iteration cap in the Run_Log.
7. IF a single LLM_Gateway request does not complete within a configured per-request timeout of 30 seconds, THEN THE Agent SHALL abort that request and terminate the run rather than holding the request open.

### Requirement 7: Keep the gateway key server-side

**User Story:** As a dispatcher-admin, I want the shared gateway key to never reach the browser, so that our shared credit pool cannot be drained through the client.

#### Acceptance Criteria

1. THE Agent SHALL read the gateway key from backend configuration (`LLM_GATEWAY_API_KEY`) only.
2. THE Agent_Endpoint SHALL NOT include the gateway key in any response returned to the frontend.
3. THE Agent SHALL NOT write the gateway key to the Run_Log or to any log output.
4. WHERE the frontend needs to run the agent, THE frontend SHALL call the Agent_Endpoint on the Go backend through the typed API client, and the Go backend SHALL proxy to the LLM_Gateway.

### Requirement 8: Log every run for replay and debugging

**User Story:** As a backend developer, I want each agent run fully logged, so that I can replay and debug a run and monitor credit usage.

#### Acceptance Criteria

1. WHEN the Agent dispatches a Tool_Call, THE Agent SHALL append an ordered Run_Log entry recording the tool name, its arguments, and its result.
2. WHEN the LLM_Gateway response includes token usage, THE Agent SHALL record the reported `usage.total_tokens` in the Run_Log.
3. THE Run_Log SHALL preserve the order in which Tool_Calls occurred within a run.

### Requirement 9: Graceful degradation when the gateway is unavailable

**User Story:** As a technician, I want to complete a report by hand when the agent is unavailable, so that a gateway outage never blocks my work.

#### Acceptance Criteria

1. IF the LLM_Gateway is unreachable or returns a non-success response, THEN THE Agent_Endpoint SHALL abort the run and return an error response indicating the agent is unavailable, and SHALL leave the Report_Draft `content`, `filled_by`, and `status` identical to their values before the run began.
2. IF the LLM_Gateway does not return a response within a configured request timeout of 60 seconds, THEN THE Agent_Endpoint SHALL abort the run, return an error response indicating the agent timed out, and leave the Report_Draft `content`, `filled_by`, and `status` unchanged.
3. IF an agent run fails at any point after issuing one or more `fill_field` Tool_Calls, THEN THE Agent SHALL NOT persist partial content to the Report_Draft and SHALL leave the Report_Draft with its pre-run `content` and its `status` as `draft`.
4. WHEN an agent run has failed, THE Report_Draft SHALL remain editable through the manual fill path with `status` as `draft`, so that the Technician can continue filling and editing every Fillable_Field by hand.
5. THE manual fill path for a Report_Draft SHALL NOT invoke the Agent_Endpoint or the LLM_Gateway, so that its availability does not depend on the availability of the LLM_Gateway.
