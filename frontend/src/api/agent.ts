// Typed API client for the AI agent's report-fill run.
//
// SECURITY — THE ONE RULE THIS MODULE EXISTS TO ENFORCE (Req 7.4):
// This is the ONLY path from the frontend to the agent. It calls the Go
// backend's Agent_Endpoint (`POST /api/reports/{id}/agent-fill`) through the
// shared `request` helper in ./client — the same seam api/reports.ts and
// api/templates.ts use. The Go backend proxies to the LLM gateway
// SERVER-SIDE; the gateway URL and key are NEVER handled client-side and are
// never referenced anywhere in this file. The browser only ever knows about a
// backend route on our own origin.
//
// Do NOT add a direct `fetch`, a gateway URL, or a gateway key here — that
// would defeat the entire point of the endpoint and leak the shared credit
// pool's key to the client.
//
// ERROR CONTRACT (mapped by ./client's `request`):
//   - A rejection with `ApiError` and `.status === 503` means the agent is
//     unavailable (gateway down or unconfigured). The caller SHOULD fall back
//     to the manual fill path — the product must not hard-depend on the agent.
//   - An `ApiValidationError` (HTTP 422) carries the input/validation problem
//     (e.g. an empty or over-length account).

import { request } from "./client";
import type { ReportRecord } from "./reportTypes";

// Body of POST /api/reports/{id}/agent-fill. The account is the technician's
// rough free-text description of the visit; the backend re-validates it
// (1..10000 chars).
export interface AgentFillInput {
  account: string;
}

// Response: the persisted (or, on a non-saving termination, unchanged) draft,
// the flagged field ids to highlight in the editor, the run's token usage, and
// why the run terminated. NEVER carries the gateway key (Req 7.2).
export interface AgentFillResponse {
  report: ReportRecord;
  flaggedFieldIds: string[];
  tokenUsage: number;
  terminatedBy: string;
}

// POST /api/reports/{id}/agent-fill — run the agent against a draft through the
// Go backend. A rejection with `ApiError` status 503 means the agent is
// unavailable (gateway down/unconfigured) and the caller should fall back to
// manual fill; a 422 (`ApiValidationError`) carries the input/validation
// problem.
export function agentFill(
  id: string,
  input: AgentFillInput,
): Promise<AgentFillResponse> {
  return request<AgentFillResponse>(
    "POST",
    `/api/reports/${encodeURIComponent(id)}/agent-fill`,
    input,
  );
}
