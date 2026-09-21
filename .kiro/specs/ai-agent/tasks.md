# Implementation Plan: AI Agent

## Overview

The implementation builds the hand-rolled JSON tool-calling loop entirely inside
`backend/internal/agent` — the only package permitted to talk to the LLM
gateway — and wires an agent-assist panel into the existing Report Editor. It
proceeds bottom-up so each layer is testable before the next depends on it:
config seams first, then the pure logic the property tests exercise (code-fence
parsing, `fill_field` validation, `filled_by` mapping, the run log), then the
gateway client, the providers, the runner loop, the `save_draft` persist closure
over the existing `reports.Store`, the HTTP endpoint, `cmd/server` composition,
and finally the frontend client and panel. Nothing new is added to the database
— the agent writes through `reports.ValidateContent` and `reports.Store.Update`.

Property tests (marked optional with `*`) inject a scripted `chatClient` mock and
NEVER hit the live gateway, per the cost-discipline rule in the tech steering.
Property tests use `pgregory.me/rapid`, minimum 100 iterations each, tagged
`// Feature: ai-agent, Property {n}: {property text}`.

Language: Go (backend), TypeScript/React (frontend) — taken directly from the
design; no language selection needed.

Prerequisites flagged in requirements/design and intentionally OUT OF SCOPE
here: seeding the `jobs` table / `internal/jobs` query functions, and creating a
`parts_catalog` table. The two context tools sit behind provider interfaces that
return empty results until that data lands.

## Tasks

- [ ] 1. Add gateway configuration seam
  - [ ] 1.1 Add LLM gateway fields and `AgentConfigured` to `internal/config`
    - Add `LLMGatewayURL`, `LLMGatewayAPIKey` (SECRET), `LLMModel` to `config.Config` in `backend/internal/config/config.go`
    - Add `const defaultLLMModel = "sonnet4.5"`
    - In `Load`, read `LLM_GATEWAY_URL` / `LLM_GATEWAY_API_KEY` (both optional, `strings.TrimSpace`) and `LLM_MODEL` (via `valueOr(..., defaultLLMModel)`); the server MUST still boot with all three unset
    - Add `func (c Config) AgentConfigured() bool` returning true only when URL and key are both non-empty
    - Never include any `LLM_*` value in an error message (mirror the existing secret-handling rule)
    - _Requirements: 7.1, 9.1_
  - [ ]* 1.2 Write unit tests for config loading
    - Assert `AgentConfigured()` is false when URL or key is blank, true when both set; `LLMModel` defaults to `sonnet4.5`; blank env still loads without error
    - _Requirements: 7.1, 9.1_

- [ ] 2. Implement code-fence stripping and tool-call parsing
  - [ ] 2.1 Implement `toolCall`, `stripCodeFences`, and `parseToolCall` in `internal/agent/runner.go`
    - Define `toolCall{ Tool, FieldID, Value json.RawMessage, JobID }`
    - `stripCodeFences`: remove a leading ```` ```json ```` / ```` ``` ```` and trailing ```` ``` ````, trim surrounding whitespace, no-op on bare JSON
    - `parseToolCall`: strip fences then unmarshal into a single JSON object with a known `"tool"` field; return an error otherwise
    - _Requirements: 6.3, 6.5_
  - [ ]* 2.2 Write property test for tool-call round-trip through code fences
    - **Property 9: tool-call parsing round-trips through code fences**
    - Generate valid tool calls, format them bare / fenced / with surrounding whitespace; assert `parseToolCall(format(call)) == call`
    - **Validates: Requirements 6.3**
  - [ ]* 2.3 Write property test for unparseable messages
    - **Property 10: an unparseable assistant message terminates the run without dispatch** (parse layer)
    - Generate non-tool-call strings (prose, partial JSON, arrays); assert `parseToolCall` returns an error
    - **Validates: Requirements 6.5**

- [ ] 3. Implement the run log
  - [ ] 3.1 Implement `RunLogEntry`, `RunLog`, and its methods in `internal/agent/runlog.go`
    - `RunLogEntry{ Seq, Kind, Tool, Args, Result, TotalTokens, Note }`
    - `RunLog{ Entries []RunLogEntry }` with `Chat(totalTokens)`, `Tool(tool, args, result)`, `Terminate(note)`, `TotalTokens()`
    - Append-only with sequential `Seq`; `TotalTokens()` sums across `chat` entries; never holds the gateway key
    - _Requirements: 8.1, 8.2, 8.3_
  - [ ]* 3.2 Write property test for run-log ordering and token sum
    - **Property 12: the run log records one ordered entry per dispatch and sums token usage**
    - Generate random tool-call + token sequences; assert one ordered entry per dispatch (tool/args/result) and `TotalTokens()` equals the sum of reported usage
    - **Validates: Requirements 8.1, 8.2, 8.3**

- [ ] 4. Implement the context provider seams
  - [ ] 4.1 Define provider interfaces and empty defaults in `internal/agent/providers.go`
    - `JobHistoryEntry`, `PartsCatalogEntry` DTOs (JSON-tagged as in the design)
    - `JobHistoryProvider` (`History(ctx, jobID *string)`) and `PartsCatalogProvider` (`Catalog(ctx)`)
    - Exported `EmptyJobHistory` / `EmptyPartsCatalog` structs returning an empty slice and nil error
    - _Requirements: 5.3, 5.5_

- [ ] 5. Implement the tool registry and the six tools
  - [ ] 5.1 Implement `toolResult`, `runState`, `toolRegistry`, and `fillableType` in `internal/agent/tools.go`
    - `toolResult{ Ok, Detail, Data }`, `runState{ schema, content *reports.ReportContent, jobID, jobs, parts, flagged, log }`
    - `toolRegistry` keyed by tool name; `fillableType` reports text|number|select|checklist
    - _Requirements: 2.1, 5.1_
  - [ ] 5.2 Implement `fill_field` validation and write
    - Reject a field id not declared by `st.schema`; reject photo/signature; validate by type (text/select = string; select value ∈ options; number parses; checklist = array of strings each ∈ options); write normalized value into `st.content.Values[field_id]` as `json.RawMessage` on success
    - Every rejection leaves content unchanged and records the rejection (id, and value/type where relevant) in the run log; the rejection is fed back to the model as `Ok:false`
    - Mirror `reports.validateValue` rules exactly
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.4_
  - [ ]* 5.3 Write property test for fillable-schema enforcement
    - **Property 1: fill_field never writes a field outside the fillable schema**
    - Generate random schemas (all six field types) + random field ids; assert accept iff declared and fillable type, else content unchanged
    - **Validates: Requirements 2.1, 2.2, 2.3, 3.4**
  - [ ]* 5.4 Write property test for value type/options validity
    - **Property 2: an accepted fill_field value is type-valid and within declared options**
    - Generate fillable fields + valid/invalid values per type; assert accept iff type-valid and (select/checklist) within options, else stored value unchanged
    - **Validates: Requirements 2.4, 2.5, 2.6**
  - [ ] 5.5 Implement `flag_missing_field`, `get_template_schema`, `get_job_history`, `get_parts_catalog`
    - `flag_missing_field`: record the id in `st.flagged`, write no value
    - `get_template_schema`: return sections → fields (id, label, type, required, options) of `st.schema`
    - `get_job_history`: call `st.jobs.History`; return entries or empty + `Ok:true`
    - `get_parts_catalog`: call `st.parts.Catalog`; return entries or empty + `Ok:true`
    - _Requirements: 3.1, 3.3, 5.1, 5.2, 5.3, 5.4, 5.5_
  - [ ]* 5.6 Write unit tests for the context/flag tools
    - Concrete accept + reject for `fill_field` per field type; `get_template_schema` returns every field id/type/required; empty providers return `Ok:true` + empty data; `flag_missing_field` records id and writes no value
    - _Requirements: 3.1, 5.1, 5.3, 5.5_

- [ ] 6. Implement the system prompt
  - [ ] 6.1 Implement the system-prompt builder in `internal/agent/prompt.go`
    - Build a system message describing the loop contract, the six tools and their exact JSON shapes, and the template schema (field ids, labels, types, required flags, options for select/checklist), plus the "reply with ONLY a JSON object" rule
    - _Requirements: 6.3, 6.4, 5.1_

- [ ] 7. Implement the gateway client
  - [ ] 7.1 Implement `gatewayClient` and its wire types in `internal/agent/client.go`
    - `chatMessage`, `chatRequest` (`stream` always false), `chatResponse`, `chatResult`
    - `newGatewayClient(baseURL, apiKey, model)` with `http.Client{ Timeout: perRequestTimeout }` (`perRequestTimeout = 30s`)
    - `Chat(ctx, messages)`: POST `{baseURL}/v1/chat/completions`, `Authorization: Bearer`, `Content-Type: application/json`; read `choices[0].message.content` + `usage.total_tokens`
    - Non-2xx / transport error / empty choices → wrapped `errGatewayUnavailable` sentinel that NEVER carries the key or a credentialed URL
    - Export a `NewGatewayClient` constructor for `cmd/server`
    - _Requirements: 6.1, 6.2, 6.7, 7.1, 7.3_
  - [ ]* 7.2 Write integration test for the gateway client against `httptest.Server`
    - Assert POST path `/v1/chat/completions`, bearer header, JSON content type, `stream:false`, and that content + total tokens are read; a delayed stub past the 30s client timeout aborts the request
    - _Requirements: 6.1, 6.2, 6.7_

- [ ] 8. Implement the tool-calling loop (runner)
  - [ ] 8.1 Implement `chatClient`, `Runner`, `RunInput`, `RunResult`, and `Run` in `internal/agent/runner.go`
    - `chatClient` interface (the mockable seam); `Runner{ client, registry, maxIters:10, overall:60s }`
    - `RunInput{ ReportID, Schema, Content (copy), JobID, Account }`; `RunResult{ Content, FlaggedFieldIDs, TotalTokens, TerminatedBy, Saved, Log }`
    - Loop: apply 60s overall context budget; build system + user messages once; up to 10 iterations calling `client.Chat`; accumulate tokens and log each chat; append assistant reply; `parseToolCall`; dispatch through registry; log each dispatch; append tool result as a message
    - Terminate: `save_draft` → run persist closure, `Saved=true`, `TerminatedBy="save_draft"`; parse failure → `parse_failure`; gateway error → `gateway_error` (or `timeout` on ctx deadline); 10 iterations without save → `iteration_cap`
    - Mutate only the in-memory content copy; persist only via the injected `persistFunc` on `save_draft`
    - _Requirements: 6.3, 6.5, 6.6, 6.7, 8.1, 8.2, 9.2, 9.3_
  - [ ]* 8.2 Write property test for atomicity of a non-saved run
    - **Property 4: a run that does not reach save_draft never mutates the persisted draft**
    - Generate runs that fill N fields then fail (parse/cap/gateway/timeout); assert persisted content/filled_by/status equal pre-run values
    - **Validates: Requirements 9.1, 9.2, 9.3**
  - [ ]* 8.3 Write property test for parse-failure termination (loop layer)
    - **Property 10: an unparseable assistant message terminates the run without dispatch**
    - Mock client emits non-tool-call content; assert `TerminatedBy == parse_failure`, no tool dispatched, parse failure logged
    - **Validates: Requirements 6.5**
  - [ ]* 8.4 Write property test for the iteration cap
    - **Property 11: the loop always terminates within the iteration cap**
    - Mock client emits ≥10 non-save replies; assert Chat called ≤10 times and `TerminatedBy == iteration_cap`; a `save_draft` reply terminates immediately
    - **Validates: Requirements 6.6**
  - [ ]* 8.5 Write property test for flagged-field set
    - **Property 7: flagged fields are returned as a set and never appear in persisted content**
    - Generate sequences of `flag_missing_field` calls with duplicates; assert returned set is the distinct ids and none carries a value in persisted content
    - **Validates: Requirements 3.2, 3.3**

- [ ] 9. Checkpoint - Ensure all backend agent-core tests pass
  - Run `go build ./...` and `go vet ./...` (prefix PATH with `/opt/homebrew/bin`); ensure all tests pass, ask the user if questions arise.

- [ ] 10. Implement the `save_draft` persist closure and `filled_by` mapping
  - [ ] 10.1 Implement `persistFunc` and the `filled_by` computation in `internal/agent/handler.go`
    - Define `persistFunc func(ctx, content reports.ReportContent) error`
    - Compute `filled_by`: prior `""`/`agent` → `agent`; prior `manual`/`mixed` → `mixed`; set `content.FilledBy`; never touch `status`
    - Persist via `reports.ValidateContent(schemaSnapshot, content, false)` then `store.Update(ctx, reportID, UpdateParams{ Content: content, CustomerName: existing.CustomerName, Title: "" })`
    - A `reports.ValidationError` propagates back and terminates the run without a partial write
    - _Requirements: 1.2, 1.3, 2.7, 4.1, 4.2_
  - [ ]* 10.2 Write property test for the Content_Validator boundary at persist time
    - **Property 3: the Content_Validator rejects any non-schema key at persist time, leaving content unchanged**
    - Generate content maps with in-schema and injected unknown keys; assert persist via `ValidateContent` rejects unknown key and stored content is unchanged
    - **Validates: Requirements 1.2, 2.7**
  - [ ]* 10.3 Write property test for the `filled_by` mapping
    - **Property 6: filled_by transitions follow the contribution mapping**
    - Generate prior `filled_by` ∈ {"", agent, manual, mixed}; assert mapped to agent/agent/mixed/mixed
    - **Validates: Requirements 1.3**
  - [ ]* 10.4 Write property test for status never changing
    - **Property 5: a completed run never changes report status**
    - Generate saved and unsaved runs; assert status is unchanged and never submitted/exported
    - **Validates: Requirements 4.1, 4.2**

- [ ] 11. Implement the Agent_Endpoint handler
  - [ ] 11.1 Implement `Handler`, request/response types, and `handleAgentFill` in `internal/agent/handler.go`
    - `Handler{ store *reports.Store, client chatClient (nil when unconfigured), jobs, parts, model }`; `NewHandler(db, client, jobs, parts)`
    - `RegisterRoutes(mux)` mounts `POST /api/reports/{id}/agent-fill`
    - `agentFillRequest{ Account }`; `agentFillResponse{ Report, FlaggedFieldIDs, TokenUsage, TerminatedBy }` — never carries the key
    - `handleAgentFill` guards, in order, before any gateway call: ownership/identity + 404 on malformed/unknown id (mirror `reports.loadOwned`); 422 when `status != draft`; decode body + trim account, 422 when empty/whitespace/>10000; 503 when `client == nil`
    - Build `Runner` + `RunInput` from the loaded record (schema snapshot, content copy, jobID, account); run; map results: gateway/timeout error → 503; parse-failure/iteration-cap with `Saved=false` → 200 with `terminatedBy` + unchanged reloaded report; `Saved=true` → reload via `store.Get` and return 200 with `flaggedFieldIds` + `tokenUsage`
    - Log the run server-side (tool calls, results, token usage, terminate reason) but never the key
    - _Requirements: 1.1, 1.4, 1.5, 1.6, 1.7, 3.2, 7.2, 7.3, 8.1, 8.2, 9.1, 9.2_
  - [ ]* 11.2 Write property test for invalid-account rejection without a gateway call
    - **Property 8: invalid accounts are rejected without contacting the gateway**
    - Generate empty/whitespace/oversized accounts; use a spy client; assert 422, zero gateway calls, draft unchanged
    - **Validates: Requirements 1.4**
  - [ ]* 11.3 Write property test for gateway-key non-leakage
    - **Property 13: the gateway key never leaks into a response or log**
    - Run with a known key configured; assert the marshaled response bytes and every run-log entry contain no key substring
    - **Validates: Requirements 7.2, 7.3**
  - [ ]* 11.4 Write integration tests for the endpoint (mocked gateway)
    - End-to-end happy path with a scripted mock (`get_template_schema` → `fill_field`×k → `flag_missing_field` → `save_draft`): draft persisted, `filled_by` updated, `status` still `draft`, flagged ids returned
    - Guards: unknown id → 404; non-draft → 422; unconfigured → 503, each with a spy asserting zero gateway calls; overall 60s stall trips the runner deadline and returns unavailable with the draft unchanged
    - _Requirements: 1.1, 1.3, 1.6, 1.7, 3.2, 9.2_

- [ ] 12. Compose the agent into the server
  - [ ] 12.1 Wire the agent handler in `cmd/server/main.go`
    - After loading config: build the gateway client only when `cfg.AgentConfigured()`, else pass `nil`
    - `agentHandler := agent.NewHandler(pool, chat, agent.EmptyJobHistory{}, agent.EmptyPartsCatalog{})`
    - Extend `mountReports` to also register the agent routes on the same `reportsMux` so they inherit the 32MB body limit and identity middleware
    - _Requirements: 1.4, 1.6, 1.7, 7.4, 9.1_
  - [ ]* 12.2 Write integration test that a failed/unconfigured run leaves the manual path working
    - After an unconfigured agent-fill (503), assert `PUT /api/reports/{id}` still succeeds against the same draft
    - _Requirements: 9.4, 9.5_

- [ ] 13. Checkpoint - Ensure the backend builds and all tests pass
  - Run `go build ./...`, `go vet ./...`, and `go test ./...` (prefix PATH with `/opt/homebrew/bin`); ensure all tests pass, ask the user if questions arise.

- [ ] 14. Implement the frontend agent API client
  - [ ] 14.1 Add `agentFill` and its types in `frontend/src/api/agent.ts`
    - `AgentFillInput{ account }`, `AgentFillResponse{ report, flaggedFieldIds, tokenUsage, terminatedBy }`
    - `agentFill(id, input)` calls `request<AgentFillResponse>("POST", \`/api/reports/${encodeURIComponent(id)}/agent-fill\`, input)` through the existing `client.ts` helper — no direct `fetch`, never references the gateway URL or key
    - _Requirements: 7.4_
  - [ ]* 14.2 Write a guard test that no frontend code references the gateway
    - Grep-style assertion: `api/agent.ts` targets the backend route; no frontend source references the gateway URL or key
    - _Requirements: 7.4_

- [ ] 15. Implement the AgentAssistPanel and wire it into the Report Editor
  - [ ] 15.1 Create `AgentAssistPanel` in `frontend/src/pages/ReportEditor/`
    - Multiline free-text input ("Describe the visit…") + a big "Fill with AI" button; disabled while a run is in flight or the account is empty/over 10000 chars
    - On submit call `agentFill(report.id, { account })`; on 503 show "The AI assistant is unavailable right now — you can fill this report in by hand." and leave the form untouched; on 422 show the validation message
    - _Requirements: 4.3, 9.1, 9.4_
  - [ ] 15.2 Integrate the panel into `ReportEditorPage`
    - Render the panel in `report` mode only (needs a report id; hidden in external/fixture modes, gated like `canSave`)
    - On success feed `report.content` into editor state via `contentFromWire(report.schemaSnapshot, report.content)`; update `customerName`/`filledBy` from the returned record
    - Extend the existing highlight mechanism (`fieldNodes` + `data-highlighted`) to accept a SET of flagged ids alongside the single `highlightedId`; highlight `flaggedFieldIds` (photo/signature required fields the agent could not fill are included in this set)
    - Leave the existing Save draft / Save and Export flow untouched so the manual path stays independent of the agent
    - _Requirements: 3.2, 3.4, 4.3, 9.5_
  - [ ]* 15.3 Write frontend tests for the panel
    - Button disabled while empty/over-length/in-flight; on success content loads via `contentFromWire` and flagged ids are highlighted; a 503 shows the fallback message and leaves the form untouched with manual Save draft still working; the panel is hidden in external/fixture modes
    - _Requirements: 3.2, 4.3, 9.1, 9.4, 9.5_

- [ ] 16. Final checkpoint - Verify backend and frontend
  - Backend: `go build ./...`, `go vet ./...`, `go test ./...` (PATH prefixed with `/opt/homebrew/bin`)
  - Frontend: `npm run build` and the typecheck/test scripts (Node/npm via asdf); ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional (unit / property / integration tests) and can be skipped for a faster MVP; core implementation tasks are never optional.
- Property tests use `pgregory.me/rapid`, minimum 100 iterations each, and are tagged `// Feature: ai-agent, Property {n}: {property text}`. They inject a scripted `chatClient` mock and never hit the live gateway (cost discipline).
- Integration tests use `httptest.Server`; no test spends the shared credit pool.
- The agent introduces no new tables or columns — `save_draft` persists through the existing `reports.ValidateContent` + `reports.Store.Update` path.
- Job-history seeding and a `parts_catalog` table are prerequisites out of scope here; the providers return empty results until that data exists.
- Each task references specific requirements for traceability; checkpoints ensure incremental validation.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "2.1", "3.1", "4.1"] },
    { "id": 1, "tasks": ["1.2", "2.2", "2.3", "3.2", "5.1", "6.1", "7.1"] },
    { "id": 2, "tasks": ["5.2", "5.5", "7.2"] },
    { "id": 3, "tasks": ["5.3", "5.4", "5.6", "8.1"] },
    { "id": 4, "tasks": ["8.2", "8.3", "8.4", "8.5", "10.1"] },
    { "id": 5, "tasks": ["10.2", "10.3", "10.4", "11.1"] },
    { "id": 6, "tasks": ["11.2", "11.3", "11.4", "12.1", "14.1"] },
    { "id": 7, "tasks": ["12.2", "14.2", "15.1"] },
    { "id": 8, "tasks": ["15.2"] },
    { "id": 9, "tasks": ["15.3"] }
  ]
}
```
