// ConversationPanel — the multi-turn "draft this report by talking to the
// agent" surface.
//
// This replaces the single-shot AgentAssistPanel in the Report Editor with a
// short chat thread. The technician's first message is the rough account of the
// visit (exactly what the one-shot path took); the agent may fill fields and
// either finish (save_draft / cap / parse) or PAUSE by asking a clarifying
// question and waiting for the technician's answer. The exchange continues,
// client-carried, until the agent finishes or the conversation hits its cap.
//
// CLIENT-CARRIED STATE: this component holds the entire running transcript in
// React state and re-sends it on every turn (the backend is stateless per
// request). On each send we optimistically append the technician's message,
// call `agentChat`, then REPLACE the transcript with the server-authoritative
// `response.messages` so the client can never drift from the server's view.
//
// COMPLETION HANDOFF: when a run finishes without awaiting an answer
// (terminatedBy save_draft / turn_cap / iteration_cap / parse_failure), we call
// `onCompleted(response)` so the parent (ReportEditorPage) loads the returned
// draft content into the editor and highlights the flagged fields — the same
// review/edit surface manual and one-shot fills land in (Req 8.3). The
// technician always stays the author of record.
//
// SECURITY: all agent traffic goes through `api/agent.ts` -> the Go backend.
// The gateway key is never handled client-side (Req 10.4).
//
// GRACEFUL DEGRADATION: on a 503 the panel shows the unavailable copy and
// leaves the transcript and the form untouched, so the technician can retry or
// fill the report by hand (Req 11.3, 11.4). The manual Save draft / Save and
// Export flow never calls this panel.

import { useState } from "react";
import { agentChat } from "../../api/agent";
import type { AgentChatResponse, ConversationMessage } from "../../api/agent";
import { ApiError, ApiValidationError } from "../../api/client";
import { colors, fontSize, radius, spacing } from "../../styles/tokens";
import { VoiceInput } from "./VoiceInput";

// Conversation caps, mirroring the backend defaults (Req 4.1, 4.2). Shipped as
// constants here; a config echo could replace them later without touching the
// render logic.
const TURN_CAP = 6;
const QUESTION_CAP = 4;

// The exact fallback copy required on a 503 (Req 11.3).
const UNAVAILABLE_MESSAGE =
  "The AI assistant is unavailable right now — you can fill this report in by hand.";
const GENERIC_ERROR_MESSAGE = "Something went wrong.";
// Shown once the conversation can no longer continue (turn cap reached).
const LIMIT_MESSAGE =
  "Conversation limit reached — finish the report by hand.";

// idle    — before the first send (no transcript yet).
// sending — a turn is in flight; the Send button is disabled.
// awaiting— the agent asked a question and is waiting for the answer.
// done    — the agent finished a run (content handed to the editor).
// error   — the last send failed; the transcript is left as it was before it.
type Phase = "idle" | "sending" | "awaiting" | "done" | "error";

interface ConversationPanelProps {
  // The draft to run the conversation against. Every turn posts to
  // /api/reports/{reportId}/agent-chat.
  reportId: string;
  // Called with the run's response when a turn finishes WITHOUT awaiting an
  // answer (terminatedBy save_draft / turn_cap / iteration_cap / parse_failure).
  // The parent loads `response.report` content into the editor and highlights
  // `response.flaggedFieldIds`.
  onCompleted: (response: AgentChatResponse) => void;
}

export function ConversationPanel({ reportId, onCompleted }: ConversationPanelProps) {
  // The running transcript (the client-carried conversation state).
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  // The current textarea contents: the account on the first send, an answer
  // after the agent asks a question.
  const [input, setInput] = useState<string>("");
  // Where the conversation is in its lifecycle.
  const [phase, setPhase] = useState<Phase>("idle");
  // A user-facing error, or null when there is nothing to show.
  const [error, setError] = useState<string | null>(null);
  // The usage counters from the last response, for the subtle usage line and
  // the cap gate. Undefined before the first successful turn.
  const [turnsUsed, setTurnsUsed] = useState<number>(0);
  const [questionsUsed, setQuestionsUsed] = useState<number>(0);

  const sending = phase === "sending";
  // The turn cap is reached once the last response reports turnsUsed >= cap.
  const capReached = turnsUsed >= TURN_CAP;
  const trimmed = input.trim();
  // Disabled while a turn is in flight, when there is nothing to send, or once
  // the conversation has hit its cap.
  const disabled = sending || trimmed.length === 0 || capReached;

  const handleSend = async () => {
    if (disabled) return;

    // The transcript this turn should carry: everything so far plus the new
    // technician message. Keep the prior transcript so we can revert the
    // optimistic append if the send fails (a retry must not double the message).
    const priorMessages = messages;
    const newTranscript: ConversationMessage[] = [
      ...priorMessages,
      { role: "technician", content: trimmed },
    ];

    // Optimistically render the technician's message and clear the input.
    setMessages(newTranscript);
    setInput("");
    setPhase("sending");
    setError(null);

    try {
      const response = await agentChat(reportId, { messages: newTranscript });
      // The server is authoritative for the transcript — replace ours with it.
      setMessages(response.messages);
      setTurnsUsed(response.turnsUsed);
      setQuestionsUsed(response.questionsUsed);

      if (response.awaitingAnswer) {
        // The agent asked a question (already the last message); keep the input
        // enabled so the technician can answer.
        setPhase("awaiting");
      } else {
        // The run finished — hand the draft to the editor and mark done. Treat
        // a turn-cap termination the same way but keep the cap gate in effect.
        setPhase("done");
        onCompleted(response);
      }
    } catch (err) {
      // The send failed. Revert the optimistic append so the transcript is
      // exactly what it was before, restore the input so nothing is lost, and
      // leave the form/editor untouched.
      setMessages(priorMessages);
      setInput(trimmed);
      setPhase("error");
      if (err instanceof ApiError && err.status === 503) {
        setError(UNAVAILABLE_MESSAGE);
      } else if (err instanceof ApiValidationError) {
        setError(err.message);
      } else {
        setError(GENERIC_ERROR_MESSAGE);
      }
    }
  };

  return (
    <section
      className="rm-no-print"
      data-testid="conversation-panel"
      aria-label="AI assistant conversation"
      style={{
        margin: `0 0 ${spacing.xl}px`,
        padding: spacing.lg,
        borderRadius: radius.lg,
        border: `1px solid ${colors.borderSubtle}`,
        background: colors.surfaceMuted,
        display: "flex",
        flexDirection: "column",
        gap: spacing.md,
      }}
    >
      <div>
        <strong style={{ fontSize: fontSize.base, color: colors.text }}>
          Draft with AI
        </strong>
        <p
          style={{
            margin: `${spacing.xs}px 0 0`,
            fontSize: fontSize.sm,
            color: colors.textMuted,
          }}
        >
          Describe what happened and answer any follow-up questions. The
          assistant fills in the report; you always review and edit before
          submitting.
        </p>
      </div>

      {/* Scrollable transcript. Technician messages align right, agent messages
          left, both high-contrast with generous padding for readability in the
          field. */}
      <div
        data-testid="conversation-messages"
        style={{
          display: "flex",
          flexDirection: "column",
          gap: spacing.sm,
          maxHeight: 320,
          overflowY: "auto",
          padding: spacing.sm,
          borderRadius: radius.md,
          border: `1px solid ${colors.borderSubtle}`,
          background: colors.surface,
        }}
      >
        {messages.length === 0 ? (
          <p
            data-testid="conversation-placeholder"
            style={{
              margin: 0,
              fontSize: fontSize.sm,
              color: colors.textMuted,
            }}
          >
            Describe the visit and I'll help fill the report.
          </p>
        ) : (
          messages.map((message, index) => {
            const isTechnician = message.role === "technician";
            return (
              <div
                key={index}
                data-testid={`conversation-message-${message.role}`}
                style={{
                  alignSelf: isTechnician ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: `${spacing.sm}px ${spacing.md}px`,
                  borderRadius: radius.md,
                  fontSize: fontSize.base,
                  lineHeight: 1.4,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  background: isTechnician ? colors.primary : colors.surfaceMuted,
                  color: isTechnician ? colors.onPrimary : colors.text,
                  border: isTechnician
                    ? `1px solid ${colors.primaryHover}`
                    : `1px solid ${colors.borderSubtle}`,
                }}
              >
                {message.content}
              </div>
            );
          })
        )}
      </div>

      {/* Usage line — subtle, always visible so the cap is never a surprise. */}
      <p
        data-testid="conversation-usage"
        style={{ margin: 0, fontSize: fontSize.xs, color: colors.textMuted }}
      >
        Questions {questionsUsed}/{QUESTION_CAP} · Turns {turnsUsed}/{TURN_CAP}
      </p>

      {/* Composer: a multiline input + a big Send button. */}
      <label htmlFor="conversation-input" style={{ display: "block" }}>
        <span
          style={{
            display: "block",
            marginBottom: spacing.xs,
            fontSize: fontSize.sm,
            color: colors.textMuted,
          }}
        >
          {phase === "awaiting" ? "Your answer" : "Account of the visit"}
        </span>
        <textarea
          id="conversation-input"
          data-testid="conversation-input"
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            // Clear a stale error the moment the technician starts typing again.
            setError((prev) => (prev === null ? prev : null));
          }}
          disabled={sending || capReached}
          rows={4}
          placeholder={
            phase === "awaiting"
              ? "Type your answer…"
              : "Describe the visit…"
          }
          style={{
            display: "block",
            width: "100%",
            boxSizing: "border-box",
            minHeight: 88,
            fontSize: fontSize.base,
            lineHeight: 1.4,
            padding: `${spacing.sm}px ${spacing.md}px`,
            borderRadius: radius.md,
            border: `1px solid ${colors.border}`,
            background: colors.surface,
            color: colors.text,
            resize: "vertical",
          }}
        />
      </label>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: spacing.md,
        }}
      >
        <button
          type="button"
          data-testid="conversation-send"
          onClick={() => void handleSend()}
          disabled={disabled}
          style={{
            minHeight: 44,
            padding: `${spacing.sm}px ${spacing.xl}px`,
            fontSize: fontSize.base,
            fontWeight: 600,
            borderRadius: radius.md,
            background: disabled ? colors.textMuted : colors.primary,
            color: colors.onPrimary,
            border: `1px solid ${disabled ? colors.textMuted : colors.primaryHover}`,
            cursor: disabled ? "default" : "pointer",
          }}
        >
          {sending ? "Working…" : "Send"}
        </button>

        {/* Voice input: dictate the account/answer. It self-hides when the
            browser has no speech recognition, so typing always works. The
            finalized transcript is APPENDED to the input, mixing with any typed
            text; a stale error is cleared on new voice input too. */}
        <VoiceInput
          disabled={sending || capReached}
          onCommit={(transcript) => {
            setInput((prev) => {
              const sep = prev.trim().length > 0 ? (prev.endsWith(" ") ? "" : " ") : "";
              return prev + sep + transcript;
            });
            setError((prev) => (prev === null ? prev : null));
          }}
        />

        {sending && (
          <span
            role="status"
            data-testid="conversation-status"
            style={{ fontSize: fontSize.sm, color: colors.textMuted }}
          >
            Working…
          </span>
        )}
      </div>

      {/* Cap-reached notice: the conversation can no longer continue. */}
      {capReached && (
        <p
          data-testid="conversation-limit"
          style={{ margin: 0, fontSize: fontSize.sm, color: colors.textMuted }}
        >
          {LIMIT_MESSAGE}
        </p>
      )}

      {error !== null && (
        <p
          role="alert"
          data-testid="conversation-error"
          style={{ margin: 0, fontSize: fontSize.sm, color: colors.dangerText }}
        >
          {error}
        </p>
      )}
    </section>
  );
}

export default ConversationPanel;
