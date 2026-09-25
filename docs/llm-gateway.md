# LLM Gateway — connection facts (verified 2026-09)

The organizer-provided gateway for **Team Simpsons**. These facts were verified
with live spikes; build the agent against them. The API key is **backend-only**
and tied to the team's shared ~$100 credit pool — never send it to the frontend,
never commit it, never log it. It lives in `.env` (git-ignored); see `.env.example`.

## What the gateway is
- A **Bedrock-backed** proxy (`owned_by: ollama-proxy-bedrock`) that is BOTH
  **OpenAI-compatible** and **Ollama-compatible**. Use the OpenAI surface — it's
  the cleanest to call from Go and it works.

## Connection
- **Base URL:** `https://api.softwaresystems.app`  (env `LLM_GATEWAY_URL`)
- **Auth header:** `Authorization: Bearer <API_KEY>`  (env `LLM_GATEWAY_API_KEY`)
- **Chat endpoint:** `POST {URL}/v1/chat/completions`
- **Models (aliases):** `sonnet4.5`, `sonnet`, `haiku`  (env `LLM_MODEL=sonnet4.5`)
  - Use these short aliases, NOT the long `global.anthropic.claude-...` ARN from
    the email — the proxy exposes the aliases.
  - Discovery: `GET /v1/models` (OpenAI) or `GET /api/tags` (Ollama).

## Verified request shape (spike that returned "CONNECTION OK")
```bash
curl -X POST "$LLM_GATEWAY_URL/v1/chat/completions" \
  -H "Authorization: Bearer $LLM_GATEWAY_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"sonnet4.5","messages":[{"role":"user","content":"..."}],"stream":false}'
```
Response is standard OpenAI: `choices[0].message.content`, plus a `usage`
token count (watch this to track credit spend).

## Tool-calling: use the MANUAL JSON pattern (per tech steering)
Do NOT rely on native tool-calling. Instead: a system prompt instructs the model
to reply with ONLY a JSON object like
`{"tool":"fill_field","field_id":"...","value":"..."}` when it wants to act. The
backend parses that, dispatches the real Go function, feeds the result back, and
loops. This was spiked successfully — the model returns clean JSON (sometimes in
a ```json fence, so strip fences before parsing).

## Cost discipline (shared $100 pool)
- Every call spends real credits. Prefer `haiku` for cheap/dev iterations,
  `sonnet4.5` for quality.
- Mock/cache during routine testing; don't fire live calls in unit tests.
- The `usage.total_tokens` field is returned on every call — log it.
