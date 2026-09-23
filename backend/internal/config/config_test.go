package config

// Unit tests for config.Load and the agent-related config seam (task 1.2).
//
// These cover the gateway configuration contract the agent depends on:
//   - AgentConfigured() is false unless BOTH the gateway URL and key are set;
//   - LLMModel defaults to "sonnet4.5" when LLM_MODEL is unset;
//   - the server still loads with all LLM_* unset (graceful degradation);
//   - DATABASE_URL is the one required setting.
//
// Load reads os.Getenv, so each case sets a clean environment with t.Setenv.

import "testing"

// setBaseEnv sets the one required var (DATABASE_URL) and clears every optional
// var this test cares about, so a case starts from a known-blank environment.
func setBaseEnv(t *testing.T) {
	t.Helper()
	t.Setenv("DATABASE_URL", "postgres://u:p@localhost:5432/db?sslmode=disable")
	t.Setenv("ENV", "")
	t.Setenv("PORT", "")
	t.Setenv("JWT_SIGNING_KEY", "")
	t.Setenv("LLM_GATEWAY_URL", "")
	t.Setenv("LLM_GATEWAY_API_KEY", "")
	t.Setenv("LLM_MODEL", "")
}

func TestLoad_RequiresDatabaseURL(t *testing.T) {
	t.Setenv("DATABASE_URL", "")
	if _, err := Load(); err == nil {
		t.Fatal("Load() should fail when DATABASE_URL is unset")
	}
}

func TestLoad_BlankLLMEnvStillLoads(t *testing.T) {
	setBaseEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load() with blank LLM_* should succeed, got: %v", err)
	}
	if cfg.AgentConfigured() {
		t.Fatal("AgentConfigured() should be false when URL and key are blank")
	}
}

func TestLoad_LLMModelDefaults(t *testing.T) {
	setBaseEnv(t)
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load(): %v", err)
	}
	if cfg.LLMModel != defaultLLMModel {
		t.Fatalf("LLMModel = %q, want default %q", cfg.LLMModel, defaultLLMModel)
	}
	if defaultLLMModel != "sonnet4.5" {
		t.Fatalf("defaultLLMModel = %q, want sonnet4.5", defaultLLMModel)
	}
}

func TestLoad_LLMModelOverride(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("LLM_MODEL", "haiku3.5")
	cfg, err := Load()
	if err != nil {
		t.Fatalf("Load(): %v", err)
	}
	if cfg.LLMModel != "haiku3.5" {
		t.Fatalf("LLMModel = %q, want haiku3.5", cfg.LLMModel)
	}
}

func TestAgentConfigured(t *testing.T) {
	cases := []struct {
		name string
		url  string
		key  string
		want bool
	}{
		{"both set", "https://gw.example", "secret", true},
		{"url only", "https://gw.example", "", false},
		{"key only", "", "secret", false},
		{"neither", "", "", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			setBaseEnv(t)
			t.Setenv("LLM_GATEWAY_URL", tc.url)
			t.Setenv("LLM_GATEWAY_API_KEY", tc.key)
			cfg, err := Load()
			if err != nil {
				t.Fatalf("Load(): %v", err)
			}
			if got := cfg.AgentConfigured(); got != tc.want {
				t.Fatalf("AgentConfigured() = %v, want %v (url=%q key=%q)", got, tc.want, tc.url, tc.key)
			}
		})
	}
}

func TestLoad_ProductionRequiresRealSigningKey(t *testing.T) {
	setBaseEnv(t)
	t.Setenv("ENV", EnvProduction)
	// No JWT_SIGNING_KEY -> must fail (dev default is not allowed in production).
	if _, err := Load(); err == nil {
		t.Fatal("Load() in production with no JWT_SIGNING_KEY should fail")
	}

	// With a real key it succeeds.
	t.Setenv("JWT_SIGNING_KEY", "a-real-production-signing-key-value")
	if _, err := Load(); err != nil {
		t.Fatalf("Load() in production with a real key should succeed, got: %v", err)
	}
}
