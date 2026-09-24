package agent

// Integration test for the gateway client against an httptest.Server (task 7.2).
// No live gateway is contacted — the stub stands in for the organizer gateway —
// so this spends no shared credit.
//
// It asserts the wire contract the client must uphold:
//   - POST to the /v1/chat/completions path
//   - Authorization: Bearer <key> and Content-Type: application/json
//   - a non-streaming body (stream:false) carrying the model and messages
//   - the response's choices[0].message.content and usage.total_tokens are read
//   - a non-2xx status maps to the errGatewayUnavailable sentinel WITHOUT the
//     key leaking into the error
//   - a stub that stalls past the client's per-request timeout aborts the call

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestGatewayClient_ChatWireContract(t *testing.T) {
	const apiKey = "super-secret-key"
	const model = "sonnet4.5"

	var gotMethod, gotPath, gotAuth, gotContentType string
	var gotBody chatRequest

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotMethod = r.Method
		gotPath = r.URL.Path
		gotAuth = r.Header.Get("Authorization")
		gotContentType = r.Header.Get("Content-Type")
		raw, _ := io.ReadAll(r.Body)
		_ = json.Unmarshal(raw, &gotBody)

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"choices": [{"message": {"role": "assistant", "content": "hello from gateway"}}],
			"usage": {"total_tokens": 137}
		}`))
	}))
	defer srv.Close()

	client := newGatewayClient(srv.URL, apiKey, model)
	res, err := client.Chat(context.Background(), []chatMessage{
		{Role: "system", Content: "sys"},
		{Role: "user", Content: "describe the visit"},
	})
	if err != nil {
		t.Fatalf("Chat() error: %v", err)
	}

	if gotMethod != http.MethodPost {
		t.Errorf("method = %q, want POST", gotMethod)
	}
	if gotPath != "/v1/chat/completions" {
		t.Errorf("path = %q, want /v1/chat/completions", gotPath)
	}
	if gotAuth != "Bearer "+apiKey {
		t.Errorf("Authorization = %q, want Bearer <key>", gotAuth)
	}
	if gotContentType != "application/json" {
		t.Errorf("Content-Type = %q, want application/json", gotContentType)
	}
	if gotBody.Stream {
		t.Error("request stream = true, want false (non-streaming)")
	}
	if gotBody.Model != model {
		t.Errorf("request model = %q, want %q", gotBody.Model, model)
	}
	if len(gotBody.Messages) != 2 {
		t.Errorf("request carried %d messages, want 2", len(gotBody.Messages))
	}
	if res.Content != "hello from gateway" {
		t.Errorf("content = %q, want the stub's content", res.Content)
	}
	if res.TotalTokens != 137 {
		t.Errorf("totalTokens = %d, want 137", res.TotalTokens)
	}
}

func TestGatewayClient_Non2xxMapsToUnavailableWithoutKeyLeak(t *testing.T) {
	const apiKey = "leaky-secret-key"
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, "upstream boom", http.StatusBadGateway)
	}))
	defer srv.Close()

	client := newGatewayClient(srv.URL, apiKey, "sonnet4.5")
	_, err := client.Chat(context.Background(), []chatMessage{{Role: "user", Content: "hi"}})
	if err == nil {
		t.Fatal("Chat() should error on a non-2xx status")
	}
	if !errors.Is(err, errGatewayUnavailable) {
		t.Fatalf("error = %v, want errGatewayUnavailable", err)
	}
	if strings.Contains(err.Error(), apiKey) {
		t.Fatalf("error message leaked the API key: %v", err)
	}
}

func TestGatewayClient_EmptyChoicesIsUnavailable(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"choices": [], "usage": {"total_tokens": 0}}`))
	}))
	defer srv.Close()

	client := newGatewayClient(srv.URL, "k", "sonnet4.5")
	if _, err := client.Chat(context.Background(), []chatMessage{{Role: "user", Content: "hi"}}); !errors.Is(err, errGatewayUnavailable) {
		t.Fatalf("empty choices should map to errGatewayUnavailable, got: %v", err)
	}
}

func TestGatewayClient_TimeoutAbortsRequest(t *testing.T) {
	// A stub that stalls longer than the client's per-request cap. Override the
	// client's http timeout to a short value so the test does not wait 30s.
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		<-release // block until the test releases it
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()
	defer close(release)

	client := newGatewayClient(srv.URL, "k", "sonnet4.5")
	client.http.Timeout = 100 * time.Millisecond // stand in for perRequestTimeout

	start := time.Now()
	_, err := client.Chat(context.Background(), []chatMessage{{Role: "user", Content: "hi"}})
	elapsed := time.Since(start)

	if err == nil {
		t.Fatal("Chat() should error when the request exceeds the client timeout")
	}
	if !errors.Is(err, errGatewayUnavailable) {
		t.Fatalf("timeout error = %v, want errGatewayUnavailable", err)
	}
	if elapsed > 2*time.Second {
		t.Fatalf("Chat() took %s; the client timeout did not abort the request", elapsed)
	}
}
