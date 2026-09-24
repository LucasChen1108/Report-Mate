# Requirements Document

## Introduction

Agent Conversation evolves Report Mate's shipped one-shot AI agent into a
multi-turn **conversation**. Today a technician gives the agent a single
free-text account of a visit and the agent fills what it can in one pass; if it
needs information it cannot infer, it flags the field and stops. This feature
lets the agent instead **ask the technician a clarifying question**, pause, wait
for the answer, and resume filling — turning report drafting into a short
collaborative exchange. It is the product's most "agentic" upgrade and directly
targets the "Best Agents Use" award for the Show Me Your Agents hackathon.

This is an **additive evolution**, not a rewrite. The conversation's first turn
is the same "describe the visit" account the one-shot path uses today, so the
existing one-shot behavior becomes the degenerate single-turn case: an account
that the agent can fully draft without needing to ask anything ends in exactly
one turn, just as it does now. Everything the shipped agent guarantees still
holds: the agent only drafts (never submits), writes only template-declared
fillable fields through the existing `reports.ValidateContent` boundary, keeps
`status` at `draft`, logs every tool call and token count, and degrades
gracefully to a fully independent manual fill path when the gateway is down.

Three decisions bound this feature and every requirement below reflects them:

1. **Client-carried conversation state.** The frontend holds the running message
   transcript and sends it back on every turn. There is **no new database table
   and no migration** for conversations. The backend endpoint is stateless per
   request: it receives the running conversation, performs one more agent turn
   (which may fill fields and/or ask a question), and returns the updated
   transcript, the current draft state, and whether the agent is now awaiting a
   technician answer.
2. **Keep the one-shot path conceptually.** The first turn is the same free-text
   account. The agent asks follow-ups only when it needs more information.
3. **Scoped-but-free-text chat.** The technician may type freely, but the agent
   is steered by its system prompt to stay focused on filling this report's
   template. It is not a general open-domain chatbot.

The **key new mechanic** is a new agent tool, `ask_technician(question)`. When
the agent needs information it cannot get from the account or its context tools
(job history, parts catalog) to fill a field, it emits an `ask_technician` call
instead of immediately flagging the field. That call **pauses the run**: the
loop stops, the backend returns the question to the frontend, and the
conversation waits for the technician's next message (their answer). The answer
becomes the next turn's technician message and the agent resumes filling.
`flag_missing_field` still exists, for when the agent gives up on a field — for
example after asking, or for photo/signature fields the human must capture.
`ask_technician` means "I need you to tell me"; `flag_missing_field` means
"you'll need to handle this yourself."

### Persistence across turns (key design question, flagged)

Because conversation state is client-carried and the backend is per-turn
stateless, the fields the agent fills must survive between turns without a
partial-write hazard. The shipped agent persists exactly once, atomically, on
`save_draft`. A multi-turn conversation must not lose a technician's filled
values between turns, and every persisted write must still go through
`reports.ValidateContent`. This document requires those guarantees (Requirement
5) and leaves the exact mechanism — persist the accumulated draft at the end of
each turn, versus persist only on the terminal `save_draft` while the client
re-supplies filled state each turn — to the design phase to resolve.

### Scope

- **In scope:** typed-text multi-turn conversation; the `ask_technician`
  pause/resume mechanic; a per-conversation cap on total turns and questions;
  client-carried transcript state; incremental, safe cross-turn persistence;
  the unchanged human-in-the-loop review-and-submit guarantee.
- **Out of scope:** voice input; any conversations database table or migration
  (state is client-carried); backfilling the job-history and parts-catalog
  providers (they remain empty seams — the agent may still `ask_technician` for
  that information).

## Glossary

- **Agent**: The backend hand-rolled JSON tool-calling loop in
  `backend/internal/agent`, the only component permitted to talk to the
  LLM_Gateway. This feature extends it to run one turn per request across a
  multi-turn conversation.
- **LLM_Gateway**: The organizer-provided, Bedrock-backed proxy reached at
  `POST {LLM_GATEWAY_URL}/v1/chat/completions` with a bearer key. External to
  Report Mate.
- **Conversation**: A single ongoing exchange between one Technician and the
  Agent aimed at drafting one Report_Draft, composed of an ordered sequence of
  Conversation_Messages. Its state is held by the frontend and re-sent on each
  Conversation_Turn.
- **Conversation_Message**: One entry in the Conversation transcript, each with
  a role (`technician` | `agent`) and text content. The technician's first
  message is the free-text account; a later technician message is an answer to
  an Agent_Question.
- **Conversation_Turn**: One request to the Agent_Endpoint carrying the running
  Conversation, during which the Agent runs its loop until it either asks a
  question (`ask_technician`) or finishes (`save_draft`), the turn cap is
  reached, or an error occurs.
- **Conversation_State**: The transcript and associated status the frontend
  holds and re-sends each Conversation_Turn. It includes the ordered
  Conversation_Messages and the count of turns and questions used so far.
- **Agent_Question**: A clarifying question the Agent emits via the
  `ask_technician` Tool_Call. Emitting it pauses the run and ends the current
  Conversation_Turn; the Conversation then awaits the Technician's answer.
- **Awaiting_Answer**: The Conversation status after the Agent has asked an
  Agent_Question and before the Technician has answered it. While in this
  status, the next Technician Conversation_Message is treated as the answer.
- **Agent_Endpoint**: The Go backend HTTP route the frontend calls to run one
  Conversation_Turn. Proxies to the LLM_Gateway server-side; the gateway key
  never leaves the backend.
- **Tool_Call**: A single JSON instruction emitted by the model, of the form
  `{"tool":"<name>", ...}`, that the Agent parses and dispatches.
- **Agent_Tool**: One of the dispatchable backend functions:
  `get_template_schema`, `get_job_history`, `get_parts_catalog`, `fill_field`,
  `flag_missing_field`, `ask_technician` (new), `save_draft`.
- **Report_Draft**: An existing `service_reports` row with `content` (values
  keyed by field id, plus a Parts Used table), `filled_by`
  (`manual` | `agent` | `mixed`), and `status` (`draft` | `submitted` |
  `exported`). The Agent writes into this model.
- **Template_Schema**: The ordered sections → typed fields (text, number,
  select, checklist, photo, signature), each with `required` and `allowMultiple`
  flags, that defines what a report contains.
- **Fillable_Field**: A field the Agent may write: type text, number, select, or
  checklist. Photo and signature fields are captured by the human and are never
  filled by the Agent.
- **Content_Validator**: The existing `reports.ValidateContent` function, which
  rejects any value written to a field id not declared by the report's schema
  snapshot. The single enforcement point for "the Agent may only write
  template-defined fields."
- **Run_Log**: The persisted, ordered record of a single Conversation_Turn's
  Agent activity — every Tool_Call, its arguments, its result, and token usage —
  sufficient to replay or debug that turn.
- **Technician**: A field user who supplies the free-text account, answers
  Agent_Questions, and reviews and edits the resulting draft before submitting.
- **Turn_Cap**: The configured maximum number of Conversation_Turns and
  Agent_Questions allowed in one Conversation, which bounds total LLM_Gateway
  usage and guarantees the Conversation terminates.

## Requirements

### Requirement 1: Multi-turn conversation with client-carried state

**User Story:** As a technician, I want to hold a back-and-forth conversation
with the agent while it drafts my report, so that it can fill more of the report
by asking me for the details it is missing.

#### Acceptance Criteria

1. WHEN the Technician starts a Conversation for an existing Report_Draft whose
   `status` is `draft` by supplying a free-text account of 1 to 10,000
   characters, THE Agent_Endpoint SHALL run one Conversation_Turn and return the
   updated Conversation_State, the current Report_Draft content, and whether the
   Conversation is Awaiting_Answer.
2. WHEN the Agent_Endpoint receives a Conversation_Turn request, THE
   Agent_Endpoint SHALL treat the Conversation transcript supplied in the
   request body as the complete Conversation_State for that turn and SHALL NOT
   read Conversation_State from a database.
3. WHEN a Conversation_Turn completes, THE Agent_Endpoint SHALL return the full
   updated Conversation transcript in the response so that the frontend can send
   it back on the next Conversation_Turn.
4. WHEN the Conversation is Awaiting_Answer and the Technician submits a text
   message, THE Agent_Endpoint SHALL append that message to the transcript as
   the Technician's answer and run the next Conversation_Turn.
5. WHERE the Agent can fully draft the Report_Draft from the first account
   without asking an Agent_Question, THE Agent SHALL complete the Conversation
   in a single Conversation_Turn, producing the same outcome as the one-shot
   fill path.
6. IF a submitted account or Technician message is empty, contains only
   whitespace, or exceeds 10,000 characters, THEN THE Agent_Endpoint SHALL
   reject the request and return a validation error identifying the invalid
   input, without invoking the LLM_Gateway and without modifying the
   Report_Draft.
7. IF a Conversation_Turn request names a Report_Draft that does not exist, THEN
   THE Agent_Endpoint SHALL reject the request and return a not-found error
   without invoking the LLM_Gateway.
8. IF a Conversation_Turn request names an existing Report_Draft whose `status`
   is not `draft`, THEN THE Agent_Endpoint SHALL reject the request and return a
   validation error indicating the report is not editable, without invoking the
   LLM_Gateway and without modifying the Report_Draft.

### Requirement 2: Ask the technician a clarifying question (pause)

**User Story:** As a technician, I want the agent to ask me for the specific
information it is missing instead of giving up on a field, so that more of the
report gets filled correctly.

#### Acceptance Criteria

1. WHEN the Agent needs information to fill a Fillable_Field that it cannot
   obtain from the Conversation transcript, the `get_job_history` Tool_Call, or
   the `get_parts_catalog` Tool_Call, THE Agent SHALL emit exactly one
   `ask_technician` Tool_Call carrying a single question of 1 to 500 characters
   rather than immediately flagging the field.
2. WHEN the Agent emits an `ask_technician` Tool_Call, THE Agent SHALL end the
   current Conversation_Turn without emitting a `save_draft` Tool_Call in that
   turn.
3. WHEN the Agent emits an `ask_technician` Tool_Call, THE Agent_Endpoint SHALL
   return the Agent_Question text to the frontend and SHALL report the
   Conversation as Awaiting_Answer.
4. WHEN a Conversation_Turn ends with an Agent_Question, THE Agent_Endpoint SHALL
   append the Agent_Question to the returned Conversation transcript as an agent
   message.
5. IF an `ask_technician` Tool_Call carries a question that is empty, contains
   only whitespace, or exceeds 500 characters, THEN THE Agent SHALL reject the
   Tool_Call, record the rejection in the Run_Log, and continue the current
   Conversation_Turn so the model can choose another action.
6. THE Agent SHALL steer the Conversation toward filling the active
   Report_Draft's Template_Schema fields and SHALL frame each Agent_Question as a
   request for information needed to fill or flag a field of that
   Template_Schema.

### Requirement 3: Resume from the technician's answer

**User Story:** As a technician, I want the agent to use my answer to keep
filling the report, so that the conversation makes real progress toward a
complete draft.

#### Acceptance Criteria

1. WHEN the Conversation is Awaiting_Answer and the Technician submits an answer,
   THE Agent SHALL run a Conversation_Turn that continues from the full prior
   transcript including the Agent_Question and the Technician's answer.
2. WHEN the Agent resumes after an answer, THE Agent SHALL be able to fill any
   Fillable_Field, flag a field, ask a further Agent_Question, or finish with
   `save_draft`, subject to the Turn_Cap.
3. WHILE a Conversation is Awaiting_Answer, THE Agent_Endpoint SHALL NOT begin a
   new Conversation_Turn until the Technician's answer message is received.

### Requirement 4: Bound the conversation length

**User Story:** As a dispatcher-admin, I want every conversation to terminate
within a fixed number of turns, so that a single report can never drain the
team's shared credit pool.

#### Acceptance Criteria

1. THE Agent SHALL enforce a configured Turn_Cap on the number of
   Conversation_Turns in one Conversation, defaulting to 6 Conversation_Turns
   when not otherwise configured.
2. THE Agent SHALL enforce a configured maximum number of Agent_Questions in one
   Conversation, defaulting to 4 Agent_Questions when not otherwise configured.
3. IF the configured Turn_Cap or the configured maximum number of Agent_Questions
   is absent or is not a positive integer, THEN THE Agent SHALL apply its default
   value (6 Conversation_Turns and 4 Agent_Questions respectively) for that
   Conversation.
4. IF a Conversation reaches the Turn_Cap without the Agent emitting a
   `save_draft` Tool_Call, THEN THE Agent_Endpoint SHALL end the Conversation,
   report that the cap was reached, and leave any already-persisted draft content
   available for the Technician to review and complete by hand.
5. WHEN a Conversation reaches its configured maximum number of Agent_Questions,
   THE Agent SHALL emit no further `ask_technician` Tool_Calls in that
   Conversation, SHALL issue a `flag_missing_field` Tool_Call for each remaining
   required Fillable_Field it has not filled, and MAY finish the Conversation
   with a `save_draft` Tool_Call.
6. WHERE a single Conversation_Turn runs the tool-calling loop, THE Agent SHALL
   apply the existing per-turn iteration cap of 10 loop iterations and terminate
   the turn if it is reached without an `ask_technician` or `save_draft`
   Tool_Call.
7. IF a single LLM_Gateway request within a Conversation_Turn does not complete
   within the configured per-request timeout of 30 seconds, THEN THE Agent SHALL
   abort that request and terminate the Conversation_Turn without holding the
   request open.

### Requirement 5: Persist filled values safely across turns

**User Story:** As a technician, I want the values filled earlier in a
conversation to never be lost as it continues, so that a long exchange reliably
produces a complete draft.

#### Acceptance Criteria

1. WHEN a Conversation_Turn after the first begins, THE Report_Draft SHALL still
   contain every Fillable_Field value the Agent persisted in an earlier
   Conversation_Turn that the Technician has not since overridden.
2. WHEN the Agent persists Report_Draft content at any point in a Conversation,
   THE Agent SHALL persist it through the Content_Validator, and IF any field
   value violates the Template_Schema THEN the Content_Validator SHALL reject the
   write and the persisted Report_Draft content SHALL remain as it was before
   that write was attempted.
3. WHEN the Agent persists content it has filled in a Conversation, THE Agent
   SHALL set the Report_Draft `filled_by` to `agent` WHERE the prior `filled_by`
   was empty or `agent`, and to `mixed` WHERE the prior `filled_by` was `manual`
   or `mixed`.
4. IF a Conversation_Turn terminates by error, timeout, or the per-turn
   iteration cap after the Agent proposed one or more `fill_field` values in that
   turn, THEN THE Report_Draft's persisted `content`, `filled_by`, and `status`
   SHALL equal their values from before that Conversation_Turn began.
5. WHERE a Fillable_Field carries a value the Technician entered or edited
   directly, THE Agent SHALL NOT overwrite that value with an Agent-proposed
   value in a later Conversation_Turn unless the Technician's answer in that
   Conversation supplies the new value.
6. WHEN a Conversation ends by any of its terminal conditions (`save_draft`,
   Turn_Cap reached, gateway error, timeout, or Technician exit), THE
   Report_Draft SHALL contain exactly the Fillable_Field values persisted during
   the Conversation and no value keyed to a field id absent from the
   Template_Schema.

### Requirement 6: Restrict writes to fillable template fields

**User Story:** As a dispatcher-admin, I want the agent constrained to the
template's own fields throughout the conversation, so that it cannot introduce
arbitrary or fabricated data no matter how many turns it takes.

#### Acceptance Criteria

1. WHEN the Agent issues a `fill_field` Tool_Call whose target field id is
   declared by the Report_Draft's Template_Schema and whose type is text,
   number, select, or checklist, THE Agent SHALL write the value to that
   Fillable_Field.
2. IF a `fill_field` Tool_Call names a field id not declared by the
   Template_Schema, THEN THE Agent SHALL reject the write, leave the content
   unchanged, and record the rejection with the offending field id in the
   Run_Log.
3. IF a `fill_field` Tool_Call targets a field of type photo or signature, THEN
   THE Agent SHALL reject the write, leave the content unchanged, and record the
   rejection with the field id and type in the Run_Log.
4. WHEN the Agent writes a value to a text or select Fillable_Field, THE Agent
   SHALL write the value as a single string, and WHEN it writes to a checklist
   Fillable_Field, THE Agent SHALL write the value as an array of strings each
   drawn from the field's declared options.
5. WHEN the Agent writes a value to a number Fillable_Field, THE Agent SHALL
   write a value that represents a number, and IF the proposed value cannot be
   interpreted as a number, THEN THE Agent SHALL reject the write, leave the
   field unchanged, and record the rejection in the Run_Log.
6. IF a `fill_field` Tool_Call targets a select or checklist field with any
   value not among the options declared for that field by the Template_Schema,
   THEN THE Agent SHALL reject the write, leave the field unchanged, and record
   the rejection with the field id and the disallowed value in the Run_Log.

### Requirement 7: Flag required fields the agent cannot fill

**User Story:** As a technician, I want the agent to flag a required field it
still cannot fill after asking me, so that I know exactly what remains for me to
handle myself.

#### Acceptance Criteria

1. WHEN the Agent cannot confidently fill a required Fillable_Field even after
   the available context and any Agent_Question, THE Agent SHALL issue a
   `flag_missing_field` Tool_Call for that field rather than writing a value.
2. WHEN a Conversation ends, THE Agent_Endpoint SHALL return the set of flagged
   field ids to the frontend for display in the Report Editor.
3. THE Agent SHALL leave any flagged field unfilled in the persisted
   Report_Draft content.
4. WHERE a required field is of type photo or signature, THE Agent SHALL report
   that field as requiring human capture with `flag_missing_field` rather than
   asking an Agent_Question about it or attempting to fill it.

### Requirement 8: Human review and submission are never bypassed

**User Story:** As a technician, I want to review and edit every value from the
conversation and be the one who submits, so that I remain the author of record
however collaborative the drafting was.

#### Acceptance Criteria

1. WHEN a Conversation ends for any reason, THE Agent SHALL leave the
   Report_Draft `status` as `draft`.
2. THE Agent SHALL NOT set a Report_Draft `status` to `submitted` or `exported`
   at any point in a Conversation.
3. WHEN the Conversation-produced draft is returned to the frontend, THE Report
   Editor SHALL present the filled and flagged fields in the same editable
   review surface used for manual and one-shot fills, for the Technician to
   review and edit before submission.
4. THE Agent SHALL NOT submit or export a Report_Draft as part of any
   Conversation_Turn, so that the final approval and submission remain the
   Technician's separate action through the existing save-and-submit flow.

### Requirement 9: Scoped-but-free-text chat

**User Story:** As a technician, I want to type to the agent freely but have it
stay focused on my report, so that the exchange stays useful rather than
wandering off topic.

#### Acceptance Criteria

1. THE Agent_Endpoint SHALL accept free-text Technician messages of 1 to 10,000
   characters as Conversation_Messages.
2. THE Agent SHALL restrict its actions in every Conversation_Turn to the
   Agent_Tools and SHALL fill only fields defined by the active Report_Draft's
   Template_Schema.
3. WHERE a Technician message requests content or actions outside filling the
   active Report_Draft's Template_Schema, THE Agent SHALL steer the Conversation
   back to filling that Template_Schema rather than acting on the out-of-scope
   request.
4. THE Agent SHALL NOT create a new report, and SHALL NOT create or modify a
   Template_Schema, during any Conversation_Turn.

### Requirement 10: Keep the gateway key server-side and log every turn

**User Story:** As a dispatcher-admin, I want the shared gateway key to stay in
the backend and every turn logged, so that a multi-turn conversation cannot leak
the key and its credit usage stays auditable.

#### Acceptance Criteria

1. THE Agent SHALL read the gateway key from backend configuration
   (`LLM_GATEWAY_API_KEY`) only.
2. THE Agent_Endpoint SHALL NOT include the gateway key in any response returned
   to the frontend.
3. THE Agent SHALL NOT write the gateway key to the Run_Log or to any log
   output during any Conversation_Turn.
4. WHERE the frontend runs a Conversation_Turn, THE frontend SHALL call the
   Agent_Endpoint on the Go backend through the typed API client in
   `frontend/src/api/`, and the Go backend SHALL proxy to the LLM_Gateway.
5. WHEN the Agent dispatches a Tool_Call in a Conversation_Turn, THE Agent SHALL
   append an ordered Run_Log entry recording the tool name, its arguments, and
   its result.
6. WHEN an LLM_Gateway response in a Conversation_Turn includes token usage, THE
   Agent SHALL record the reported `usage.total_tokens` in the Run_Log.

### Requirement 11: Graceful degradation when the gateway is unavailable

**User Story:** As a technician, I want to complete a report by hand when the
agent is unavailable mid-conversation, so that a gateway outage never blocks my
work.

#### Acceptance Criteria

1. IF the LLM_Gateway is unreachable or returns a non-success response during a
   Conversation_Turn, THEN THE Agent_Endpoint SHALL abort that turn and return an
   error response indicating the agent is unavailable, leaving the persisted
   Report_Draft content, `filled_by`, and `status` as they were before that turn
   began.
2. IF the LLM_Gateway does not return a response within the configured per-turn
   request timeout of 60 seconds, THEN THE Agent_Endpoint SHALL abort the
   Conversation_Turn, return an error indicating the agent timed out, and leave
   the persisted Report_Draft content, `filled_by`, and `status` unchanged.
3. WHEN a Conversation_Turn has failed, THE Report_Draft SHALL remain editable
   through the manual fill path with `status` as `draft`, so that the Technician
   can continue filling and editing every Fillable_Field by hand.
4. THE manual fill path for a Report_Draft SHALL NOT invoke the Agent_Endpoint or
   the LLM_Gateway, so that its availability does not depend on the availability
   of the LLM_Gateway.
5. WHERE the gateway is unconfigured, THE Agent_Endpoint SHALL return an
   agent-unavailable response for a Conversation_Turn without invoking the
   LLM_Gateway and without modifying the Report_Draft.
