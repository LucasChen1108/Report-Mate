package agent

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"time"
)

// perRequestTimeout is the hard cap on a single gateway chat request (Req 6.7).
// It is applied as the gatewayClient's http.Client timeout, so a stalled
// request is aborted after 30 seconds regardless of the caller's context.
const perRequestTimeout = 30 * time.Second

// errGatewayUnavailable is the sentinel returned by Chat for any failure to
// obtain a usable completion: a transport error, a non-2xx status, or an empty
// choices array. The endpoint maps it to a 503 so the technician falls back to
// the manual fill path (Req 9.1). Wrapped detail NEVER carries the API key or a
// credentialed URL (Req 7.3) — only a generic reason or an HTTP status code.
var errGatewayUnavailable = errors.New("agent: llm gateway unavailable")

// chatMessage is one OpenAI-style message in the conversation transcript.
type chatMessage struct {
	Role    string `json:"role"` // "system" | "user" | "assistant" | "tool"
	Content string `json:"content"`
}

// chatRequest is the POST /v1/chat/completions body. Stream is always false —
// the agent reads a single, complete assistant message per turn.
type chatRequest struct {
	Model    string        `json:"model"`
	Messages []chatMessage `json:"messages"`
	Stream   bool          `json:"stream"`
}

// chatResponse is the subset of the OpenAI-compatible response the agent reads:
// the first choice's message content and the token usage total.
type chatResponse struct {
	Choices []struct {
		Message chatMessage `json:"message"`
	} `json:"choices"`
	Usage struct {
		TotalTokens int `json:"total_tokens"`
	} `json:"usage"`
}

// chatResult is what the loop consumes: the assistant text and the reported
// token count (summed across a run for credit tracking, Req 8.2).
type chatResult struct {
	Content     string
	TotalTokens int
}

// gatewayClient posts chat completions to the organizer gateway. It is the only
// holder of the API key at request time; the key is never logged and never
// returned to the client.
type gatewayClient struct {
	baseURL string
	apiKey  string // SECRET
	model   string
	http    *http.Client
}

// newGatewayClient builds a gatewayClient with the 30s per-request timeout as
// its hard cap (Req 6.7).
func newGatewayClient(baseURL, apiKey, model string) *gatewayClient {
	return &gatewayClient{
		baseURL: baseURL,
		apiKey:  apiKey,
		model:   model,
		http:    &http.Client{Timeout: perRequestTimeout},
	}
}

// NewGatewayClient is the exported constructor cmd/server uses to compose the
// agent when the gateway is configured. It returns a *gatewayClient, whose Chat
// method satisfies the runner's chatClient interface (defined in the same
// package, so no import cycle).
func NewGatewayClient(baseURL, apiKey, model string) *gatewayClient {
	return newGatewayClient(baseURL, apiKey, model)
}

// Chat sends messages to the gateway and returns the assistant content plus the
// reported token usage.
//
// It posts to {baseURL}/v1/chat/completions with an Authorization: Bearer
// header and Content-Type: application/json, and a non-streaming body
// (Req 6.1). It reads choices[0].message.content and usage.total_tokens
// (Req 6.2, 8.2).
//
// The caller's ctx bounds the request (the runner applies the 60s overall
// budget), and the client's 30s Timeout is the hard per-request cap (Req 6.7).
//
// A transport error, a non-2xx status, or an empty choices array is returned as
// a wrapped errGatewayUnavailable. The returned error NEVER contains the API
// key or a credentialed URL (Req 7.3): only a generic reason or an HTTP status
// code is included.
func (c *gatewayClient) Chat(ctx context.Context, messages []chatMessage) (chatResult, error) {
	body, err := json.Marshal(chatRequest{
		Model:    c.model,
		Messages: messages,
		Stream:   false,
	})
	if err != nil {
		return chatResult{}, fmt.Errorf("%w: could not encode request", errGatewayUnavailable)
	}

	url := c.baseURL + "/v1/chat/completions"
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, url, bytes.NewReader(body))
	if err != nil {
		// Do not wrap err here: it can contain the (credentialed) URL.
		return chatResult{}, fmt.Errorf("%w: could not build request", errGatewayUnavailable)
	}
	req.Header.Set("Authorization", "Bearer "+c.apiKey)
	req.Header.Set("Content-Type", "application/json")

	resp, err := c.http.Do(req)
	if err != nil {
		// Do not wrap err: a transport error may embed the target URL.
		return chatResult{}, fmt.Errorf("%w: request failed", errGatewayUnavailable)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		// Only the status code is safe to include — never the response body,
		// which could echo the request or a credentialed URL.
		return chatResult{}, fmt.Errorf("%w: gateway returned status %d", errGatewayUnavailable, resp.StatusCode)
	}

	raw, err := io.ReadAll(resp.Body)
	if err != nil {
		return chatResult{}, fmt.Errorf("%w: could not read response", errGatewayUnavailable)
	}

	var decoded chatResponse
	if err := json.Unmarshal(raw, &decoded); err != nil {
		return chatResult{}, fmt.Errorf("%w: could not decode response", errGatewayUnavailable)
	}
	if len(decoded.Choices) == 0 {
		return chatResult{}, fmt.Errorf("%w: gateway returned no choices", errGatewayUnavailable)
	}

	return chatResult{
		Content:     decoded.Choices[0].Message.Content,
		TotalTokens: decoded.Usage.TotalTokens,
	}, nil
}
