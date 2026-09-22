# Implementation Plan: Agent Conversation

## Overview

This plan extends the shipped one-shot agent (`backend/internal/agent`) and the
Report Editor (`frontend/src/pages/ReportEditor`) into a multi-turn
conversation. Everything is **additive**: `POST /api/reports/{id}/agent-fill`
and its runner/handler paths stay untouched; a new `POST
/api/reports/{id}/agent-chat` endpoint runs one turn from a client-carried
transcript.

The work builds bottom-up: wire types and config caps first, then the
`ask_technician` tool contract and prompt, then the runner generalization
(transcript assembly, pause interception, `Filled` tracking), then the handler
(transcript validation, cap derivation, turn-end persist), then wiring into
`cmd/server`, then the frontend client and `ConversationPanel`. Tests sit as
optional sub-tasks beside the code they validate.

Because several agent files are touched by more than one task —
`runner.go`, `tools.go`, `handler.go`, `prompt.go`, `config.go`,
`api/agent.ts`, `ReportEditorPage.tsx` — tasks that write the same file are
sequenced into different waves (see Task Dependency Graph) so parallel workers
never conflict on a file.

Languages are fixed by the design: **Go** for the backend, **TypeScript/React**
for the frontend. Property-based tests use **`pgregory.net/rapid`** (add to
`go.mod`), minimum 100 iterations each, with a scripted mock `chatClient` —
never the live gateway.

Environment: prefix `PATH` with `/opt/homebrew/bin` for Go; the frontend uses
Node/npm via asdf. Do not run dev servers or watchers as part of any task.

## Tasks

- [ ] 1. Add conversation caps to config
  - [ ] 1.1 Add `ConversationTurnCap` / `ConversationQuestionCap` and `resolveCap`
    - In `backend/internal/config/config.go`, add `defaultTurnCap = 6` and `defaultQuestionCap = 4` constants
    - Add `ConversationTurnCap int` and `ConversationQuestionCap int` fields to `Config`
    - Add `resolveCap(raw string, def int) int` using `strconv.Atoi(strings.TrimSpace(raw))`, returning `def` when absent, zero, negative, or non-numeric
    - In `Load`, set the two fields from `AGENT_CONVERSATION_TURN_CAP` / `AGENT_CONVERSATION_QUESTION_CAP` via `resolveCap`
    - _Requirements: 4.1, 4.2, 4.3_

  - [ ]* 1.2 Write property test for cap resolution
    - **Property 9: Cap resolver applies defaults for invalid config**
    - Random env strings (absent, "0", "-3", "abc", "5"); assert resolved cap equals default for invalid input and the parsed positive int otherwise
    - **Validates: Requirements 4.3**

- [ ] 2. Add conversation wire types and the `Question` tool field (backend)
  - [ ] 2.1 Define `ConversationMessage`, chat request/response types, add `Question` to `toolCall`
    - Add `ConversationMessage{Role, Content}` (roles `"technician"|"agent"`) as a new backend type in the `agent` package (e.g. a new `conversation.go`)
    - Add `agentChatRequest{Messages []ConversationMessage}` and `agentChatResponse{Messages, Report, FlaggedFieldIDs, AwaitingAnswer, TerminatedBy, TokenUsage, TurnsUsed, QuestionsUsed}`; the response NEVER carries the gateway key
    - Add `Question string \`json:"question,omitempty"\`` to `toolCall` in `runner.go`
    - _Requirements: 1.1, 1.3, 2.4, 10.2_

  - [ ] 2.2 Add transcript validation and cap-derivation helpers
    - In the `agent` package, add `validateTranscript(messages []ConversationMessage) error`: non-empty; each role in `{technician, agent}`; each `content` `1 <= len(TrimSpace) <= 10000`; technician-first; every `agent` preceded by a `technician`; the LAST message is `technician`
    - Add `questionsUsed(messages)` (count of agent-role messages) and `turnsUsed(messages)` (equal to `questionsUsed`)
    - _Requirements: 1.4, 1.6, 3.3, 9.1_

  - [ ]* 2.3 Write property test for message validation with no side effects
    - **Property 4: Message validation rejects invalid input with no side effects**
    - Generate empty/whitespace-only/over-10000-char messages; assert validation rejects and (paired with the handler test in 6.x) zero gateway calls and unchanged draft
    - **Validates: Requirements 1.6, 9.1**

- [ ] 3. Extend the system prompt for `ask_technician` and the question budget
  - [ ] 3.1 Add `questionsRemaining` param and `ask_technician` contract to `buildSystemPrompt`
    - Change `buildSystemPrompt(schema)` to `buildSystemPrompt(schema, questionsRemaining int)` in `backend/internal/agent/prompt.go`
    - Add the `ask_technician` tool description (ask ONE short question <=500 chars; emitting it pauses the draft; prefer asking over flagging; frame as filling/flagging a specific field)
    - Add a budget line stating the remaining question count for the turn
    - When `questionsRemaining <= 0`, emit the "do NOT call ask_technician; flag remaining required fields then save_draft" instruction instead
    - Keep the existing scoping text (fill only template fields; never create a report/template)
    - _Requirements: 2.6, 4.5, 9.3, 9.4_

  - [ ]* 3.2 Write prompt smoke unit tests
    - Assert the prompt contains the `ask_technician` scoping text when `questionsRemaining > 0`, and the "do not ask" instruction when `questionsRemaining <= 0`
    - _Requirements: 2.6, 4.5, 9.3_

- [ ] 4. Generalize the runner for transcripts and `ask_technician`
  - [ ] 4.1 Rework `RunInput`/`RunResult` and message assembly
    - In `backend/internal/agent/runner.go`, drop `Account` from `RunInput`; add `Messages []ConversationMessage` and `QuestionsRemaining int`
    - Add `AwaitingAnswer`, `Question`, `Filled` fields to `RunResult`
    - Replace the fixed `[system, user(account)]` seed with `buildSystemPrompt(schema, in.QuestionsRemaining)` followed by each `ConversationMessage` mapped `technician->user`, `agent->assistant`, preserving order; seed `runState.content` from `copyContent(in.Content)` (the reloaded persisted content)
    - _Requirements: 1.4, 3.1, 5.1, 5.5_

  - [ ] 4.2 Intercept `ask_technician` as a pause and track `Filled`
    - Between the `save_draft` interception and registry dispatch, intercept `call.Tool == "ask_technician"`
    - Validate the question: trim; reject empty/whitespace or `len > 500`; also reject when `in.QuestionsRemaining <= 0`. A rejected question is logged and the loop CONTINUES (feed a `TOOL RESULT` back), no pause
    - A valid question pauses: set `TerminatedBy="ask_technician"`, `AwaitingAnswer=true`, `Question=trimmed`, `Content=*st.content`, collect flagged ids, log `Terminate("ask_technician")`, and return WITHOUT emitting `save_draft`
    - Set `result.Filled = true` whenever a dispatched `fill_field` returns `Ok:true`; populate `Filled` on every terminal return (pause, save_draft, iteration_cap, parse_failure)
    - Keep the `save_draft` inline persist unchanged
    - _Requirements: 2.2, 2.3, 2.4, 2.5, 4.5, 4.6_

  - [ ]* 4.3 Write property test for transcript growth
    - **Property 1: Transcript growth**
    - **Validates: Requirements 1.3, 2.4**

  - [ ]* 4.4 Write property test for message assembly order/role mapping
    - **Property 2: Message assembly preserves order and role mapping**
    - **Validates: Requirements 1.4, 3.1**

  - [ ]* 4.5 Write property test for one-shot equivalence
    - **Property 3: One-shot equivalence** — a single-turn chat run that fills + save_draft (no question) persists the same content as agent-fill for the same input
    - **Validates: Requirements 1.5**

  - [ ]* 4.6 Write property test for the pause invariant
    - **Property 5: ask_technician always pauses and never co-occurs with save_draft**
    - **Validates: Requirements 2.2, 2.3, 2.4**

  - [ ]* 4.7 Write property test for invalid-question rejection + loop continuation
    - **Property 6: Invalid question is rejected and the loop continues**
    - **Validates: Requirements 2.5**

  - [ ]* 4.8 Write property test for the question-cap block inside a turn
    - **Property 8: Question cap forbids further questions** — with `QuestionsRemaining <= 0`, any `ask_technician` is rejected and the loop continues
    - **Validates: Requirements 4.2, 4.5**

  - [ ]* 4.9 Write property test for the per-turn iteration cap
    - **Property 10: Per-turn iteration cap terminates the turn** — a scripted model that never asks/saves terminates by iteration cap within 10 iterations
    - **Validates: Requirements 4.6**

- [ ] 5. Generalize the persistence seam for turn-end persist
  - [ ] 5.1 Confirm/adjust `newPersistFunc` for a non-`save_draft` turn-end persist
    - In `backend/internal/agent/handler.go`, confirm `newPersistFunc` persists once through `filledByAfterAgent` + `reports.ValidateContent(schema, content, false)`, writing an empty `Title` and never `status`, so it can be reused for pause/cap persists (no signature change expected; add only if needed)
    - _Requirements: 5.2, 5.3, 8.1_

  - [ ]* 5.2 Write property tests for cross-turn persistence and validation
    - **Property 11: Prior-turn values survive a reload seed** — **Validates: Requirements 5.1, 5.5**
    - **Property 12: Persist goes through the Content_Validator** — **Validates: Requirements 5.2, 5.6**
    - **Property 13: filled_by transition** — **Validates: Requirements 5.3**
    - Use a fake `reports.Store` / `persistFunc` seam that records writes; one property-based test per property, each 100+ iters
    - _Requirements: 5.1, 5.2, 5.3, 5.5, 5.6_

  - [ ]* 5.3 Write property tests for fill/flag/status invariants
    - **Property 15: Valid fills land in content in the validator-accepted shape** — **Validates: Requirements 6.1, 6.4**
    - **Property 16: fill_field rejects unwritable targets and values** — **Validates: Requirements 6.2, 6.3, 6.5, 6.6**
    - **Property 17: Flagged set is returned and flagged fields stay unfilled** — **Validates: Requirements 7.2, 7.3**
    - **Property 18: Status invariant** — **Validates: Requirements 8.1, 8.2, 8.4**
    - **Property 20: Run log mirrors dispatch and sums token usage** — **Validates: Requirements 10.5, 10.6**
    - Random `(field, value)` pairs over the six field types and scripted action sequences against a fake store; one test per property
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 7.2, 7.3, 8.1, 8.2, 8.4, 10.5, 10.6_

- [ ] 6. Add the `handleAgentChat` endpoint
  - [ ] 6.1 Implement `handleAgentChat` guard ladder, transcript validation, and cap derivation
    - In `backend/internal/agent/handler.go`, add `mux.HandleFunc("POST /api/reports/{id}/agent-chat", h.handleAgentChat)` to `RegisterRoutes` (leave `agent-fill` untouched)
    - Reuse the guard ladder verbatim: identity 401 → UUID/existence 404 → ownership 403 → status-draft 422 → gateway-configured 503
    - Decode `agentChatRequest` with `DisallowUnknownFields`; call `validateTranscript` → 422 with NO gateway call and NO draft change on failure
    - Compute `turnsUsed`/`questionsUsed` from the transcript; if `turnsUsed >= turnCap`, reload the report and return `terminatedBy:"turn_cap"`, `awaitingAnswer:false` with NO gateway call
    - Add the two cap `int`s to the `Handler` struct and `NewHandler`/`NewHandlerFromConfig` signatures; share the `client == nil` 503 branch
    - _Requirements: 1.1, 1.2, 1.6, 1.7, 1.8, 4.1, 4.4, 9.1, 11.5_

  - [ ] 6.2 Run one turn, perform turn-end persist, and map the response
    - Reload the report to seed `runState.content` (Req 5.1), build `RunInput` with `Messages`, `QuestionsRemaining = questionCap - questionsUsed`, and run one turn
    - Handler performs the single turn-end persist when `runErr == nil && !res.Saved && res.Filled && (TerminatedBy == "ask_technician" || "iteration_cap")`; a `ValidateContent` failure maps to 422 with the offending element, prior content intact
    - Persist NOTHING on gateway error/timeout/parse_failure/no-fills; map gateway/timeout errors to 503 (reuse agent-fill error logic)
    - Reload the report, append the agent question message on a pause, and return `agentChatResponse` with grown `Messages`, `AwaitingAnswer`, `TerminatedBy`, `TokenUsage`, `TurnsUsed`, `QuestionsUsed`, `FlaggedFieldIDs`
    - _Requirements: 1.3, 2.3, 2.4, 5.2, 5.4, 7.2, 8.1, 11.1, 11.2_

  - [ ]* 6.3 Write property tests for turn-cap termination, failed-turn atomicity, and key safety
    - **Property 7: Turn cap derived from the transcript always terminates** — no gateway call, reloaded draft unchanged — **Validates: Requirements 4.1, 4.4**
    - **Property 14: A failed turn persists nothing** — **Validates: Requirements 5.4, 11.1**
    - **Property 19: The gateway key never leaks** — a sentinel key never appears in the serialized response body or Run_Log — **Validates: Requirements 10.2, 10.3**
    - _Requirements: 4.1, 4.4, 5.4, 10.2, 10.3, 11.1_

  - [ ]* 6.4 Write guard-ladder and integration tests (httptest, mock chatClient)
    - Guard examples: 401/404/403/422 (non-draft), 422 (invalid transcript), 503 (unconfigured) each asserting ZERO mock gateway calls
    - Full pause/resume across two requests: turn 1 asks and persists the partial fill; turn 2 resumes from the returned transcript and saves; assert turn-1 values survive into turn 2 and the final draft is complete
    - Timeout → 503, draft unchanged; gateway error → 503, draft unchanged
    - _Requirements: 1.7, 1.8, 5.1, 11.1, 11.2, 11.5_

- [ ] 7. Wire the caps through `cmd/server`
  - [ ] 7.1 Pass conversation caps into the agent handler
    - In `backend/cmd/server/main.go`, pass `cfg.ConversationTurnCap` and `cfg.ConversationQuestionCap` into `agent.NewHandlerFromConfig` (updated signature from task 6.1)
    - _Requirements: 4.1, 4.2, 4.3_

- [ ] 8. Add the frontend chat client
  - [ ] 8.1 Add `agentChat` and conversation types to `api/agent.ts`
    - In `frontend/src/api/agent.ts`, add `ConversationRole`, `ConversationMessage`, `AgentChatInput`, `AgentChatResponse` types
    - Add `agentChat(id, input)` calling `POST /api/reports/{id}/agent-chat` through the existing `request` helper — no direct fetch, no gateway URL/key
    - Keep `agentFill` and its types intact
    - _Requirements: 1.3, 10.2, 10.4_

- [ ] 9. Build the `ConversationPanel` and wire it into the editor
  - [ ] 9.1 Create `ConversationPanel.tsx`
    - Create `frontend/src/pages/ReportEditor/ConversationPanel.tsx` holding `messages`, `input`, `phase` in React state
    - Render a scrollable message list (technician right, agent left, high-contrast, big tap targets) with an input + send control
    - On send: append `{role:"technician", content: input}`, call `agentChat(reportId, {messages})`, replace `messages` with `response.messages`; disable send + show "Working…" while in flight
    - On `awaitingAnswer:true`: keep the input enabled for the answer (question is already the last message)
    - On completion (`awaitingAnswer:false`): call an `onFilled`-style callback with `response`; set `phase="done"`
    - Show usage (`Questions x/cap`, `Turns x/cap`) using constants mirroring backend defaults (6/4); disable send when `turnsUsed >= turnCap` with the limit message
    - On `ApiError` status 503: show the unavailable copy, leave transcript and form untouched
    - _Requirements: 1.1, 1.3, 1.4, 2.3, 4.1, 8.3, 11.3, 11.4_

  - [ ] 9.2 Mount `ConversationPanel` in `ReportEditorPage`
    - In `frontend/src/pages/ReportEditor/ReportEditorPage.tsx`, render `ConversationPanel` in the same `usingReport && report` slot currently holding `AgentAssistPanel`
    - Reuse `handleAgentFilled` for the completed-run case so `response.report` loads via `contentFromWire` and `response.flaggedFieldIds` drives the highlight set (accept the `AgentChatResponse` shape, which shares `report`/`flaggedFieldIds`)
    - Keep `AgentAssistPanel.tsx` in the tree but no longer mounted; leave the manual Save draft / Save and Export flow untouched
    - _Requirements: 8.3, 8.4, 11.4_

  - [ ]* 9.3 Write frontend tests for the conversation panel (mocked `agentChat`)
    - Chat thread: first send posts `{messages:[{technician, account}]}`; returned transcript renders in order
    - Awaiting answer: `awaitingAnswer:true` shows the agent question, keeps input enabled, next send includes the full transcript
    - Completion: `awaitingAnswer:false` loads `report` content into the editor and highlights `flaggedFieldIds`
    - Cap disable: `turnsUsed >= turnCap` disables send with the limit message
    - 503 fallback: `ApiError` status 503 shows the unavailable copy, leaves the transcript and form untouched, and the manual Save buttons still work
    - _Requirements: 1.3, 1.4, 2.3, 4.1, 8.3, 11.3, 11.4_

- [ ] 10. Checkpoint — backend verification
  - Run backend build/vet/format and tests; ask the user if questions arise.
  - `export PATH="/opt/homebrew/bin:$PATH"; go build ./...` (cwd `backend`)
  - `go vet ./...` and `gofmt -l .` (no files listed) (cwd `backend`)
  - `go test ./internal/agent/... ./internal/config/...` (cwd `backend`)

- [ ] 11. Checkpoint — frontend verification
  - Run frontend typecheck, tests, and build; ask the user if questions arise.
  - `npx tsc -p tsconfig.app.json --noEmit` (cwd `frontend`)
  - Run the frontend test suite for the ReportEditor
  - `npm run build` (cwd `frontend`)

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a
  faster MVP. Core implementation tasks are never optional.
- The feature is strictly additive: `agent-fill`, its runner path, and the
  manual fill flow stay working throughout.
- All property tests use `pgregory.net/rapid` (add to `backend/go.mod`), run a
  minimum of 100 iterations, are tagged `// Feature: agent-conversation,
  Property {n}: {property text}`, and drive a scripted mock `chatClient` — never
  the live gateway (protects the shared credit pool).
- Every task references specific requirement clauses for traceability.
- File-conflict sequencing: `config.go` (task 1), `prompt.go` (task 3),
  `runner.go` (tasks 2.1, 4.1, 4.2 — sequenced), `handler.go` (tasks 5.1, 6.1,
  6.2 — sequenced), `api/agent.ts` (task 8), `ReportEditorPage.tsx` (task 9.2)
  each land in ordered waves so no two parallel workers write the same file.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1", "3.1"] },
    { "id": 1, "tasks": ["1.2", "3.2", "2.1"] },
    { "id": 2, "tasks": ["2.2", "8.1"] },
    { "id": 3, "tasks": ["2.3", "4.1"] },
    { "id": 4, "tasks": ["4.2"] },
    { "id": 5, "tasks": ["4.3", "4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "5.1"] },
    { "id": 6, "tasks": ["5.2", "5.3", "6.1"] },
    { "id": 7, "tasks": ["6.2"] },
    { "id": 8, "tasks": ["6.3", "6.4", "7.1", "9.1"] },
    { "id": 9, "tasks": ["9.2"] },
    { "id": 10, "tasks": ["9.3"] }
  ],
  "notes": [
    "5.1 (wave 5) and 6.1 (wave 6) both write handler.go; kept in separate waves.",
    "6.1 (wave 6) and 6.2 (wave 7) both write handler.go; kept in separate waves.",
    "2.1/4.1/4.2 all write runner.go; kept in waves 1/3/4 respectively."
  ]
}
```
