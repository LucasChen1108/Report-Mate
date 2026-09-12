# Kiro Credit Plan + Architecture Feedback

Evaluation of the plan in `hackathon-plan.md`, done 2026-09-09. Sources: "Show Me Your Agents" official page (iss.nus.edu.sg), Kiro's official pricing blog (kiro.dev), third-party Kiro guides, the organizer's "Important info for your build" email (2026-09-09), and the organizer-shared starter kit repo — see chat for full citations.

## Update 2026-09-09: two separate credit pools, plus an official starter kit

The team's registered contact got an email clarifying the hosting/inference setup, followed by a starter kit repo. Together they replace the earlier assumptions in this doc (Bedrock-via-RDS/S3, unclear "OpenClaw").

**Two distinct allocations:**

1. **Kiro credits — $1000/person, 4 people.** Build-time only, spent inside the Kiro IDE while writing code. Unaffected by everything below.
2. **Team hosting + LLM credits — ~$100 total, shared across the whole 4-person team.** Covers a custom AWS sandbox account: hosting via **Lightsail** (not general EC2/RDS), and LLM/API inference through a provided API URL + API key. Not for training/fine-tuning. This ~$100 shared across hosting AND every LLM call (dev, testing, demo) is the tight constraint on the project — not the Kiro allocation.

**What the gateway actually is** (per the starter kit, [kenken64/ShowMeYourAgent-Starter-Kit](https://github.com/kenken64/ShowMeYourAgent-Starter-Kit)): it's a self-hosted, **Bedrock-backed** LLM gateway running on the Lightsail instance, exposed through an **Ollama-compatible** interface (via API Gateway → Lambda → Bedrock Converse, or a direct Ollama-compatible proxy). So Bedrock models ARE reachable — just through this proxy, not Bedrock's own SDK directly. "OpenClaw" and "Hermes" are **pre-built AI agents**, not model names: OpenClaw installs via an onboarding wizard and has a generic Ollama-compatible provider option (`~/.openclaw/openclaw.json`, `provider.api: "ollama"`); Hermes Agent (Nous Research) has no generic-provider option, so the repo includes a translation proxy (`hermes-ollama-proxy/proxy.py`, systemd service) that speaks Hermes's specific tool-call format.

**Important gotcha the repo documents from real debugging:** native tool-calling on the gateway is flaky. The repo describes a real case where the gateway's Claude-Code-style tool-call XML wasn't translating correctly, causing the model to fabricate tool results, until the proxy's parser was fixed. Its own test scripts (`test_llm_gateway.py`, `test_llm_gateway_langgraph.py`) work around this by having the model emit a JSON tool request that's parsed manually, rather than relying on native tool-calling. A "proper" LangGraph `bind_tools()`/`ToolNode` pattern exists (`test_llm_gateway_langgraph_native.py`) but only worked against a local proxy — the public gateway was on a stale build without native tool-call support at time of writing. **Plan for manual JSON-parse tool-calling, don't assume native tool-calling works**, and verify against the current gateway build before depending on it for the report-filling feature.

### What this means for the build
- **Infra:** follow the repo's README directly for provisioning the Lightsail Ubuntu instance — it's the exact setup the $100 pool is scoped to, no need to reinvent it.
- **Decide: adopt a pre-built agent, or go custom.** OpenClaw or Hermes-via-proxy are ready to point at the gateway. Given the team's backend is Go, also look at the repo's `weather_demo.py` — a dependency-free, stdlib-only Ollama tool-calling loop — it's simple enough to port straight to Go, avoiding a second runtime (Python) just for the agent. Worth a quick team decision early rather than defaulting into whichever the AI-feature owner tries first.
- **Security:** the repo includes `test_invalid_api_key.py`, confirming the gateway rejects bad `X-API-Key` values. Worth running that check early since the team's key is tied to their usage/credits.
- **DB/hosting:** Lightsail-managed PostgreSQL + a Lightsail instance/container for the Go backend + React frontend, not RDS/Aurora/S3 (this doc's earlier RDS/Aurora/Bedrock-direct recommendation is superseded by all of the above).
- **Remaining open question for organizers:** whether the $100 team pool and the "$1000 credits each person" figure mentioned at sponsorship are the same program or genuinely separate — the numbers don't match, so worth a direct check rather than assuming.

## Hackathon facts that change the plan

- Kickoff was Sept 5, 2026. Build phase is **Sept 7–25**. Final submission **Sept 28**. Demo Day Oct 10. So "Week 1/2/3" should map to roughly Sept 7–13 / 14–20 / 21–25, not a fresh 21 days starting whenever the team picks up the doc — as of today (Sept 9) the team is already ~3 days into Week 1.
- Public category requires exactly 4 members — matches the 4-person Kiro credit allocation.
- Judging leans on "practical, secure, deployment-ready" agentic solutions; there's a specific "Best Agents Use" special award. The in-app AI chatbot is very likely the single most heavily-weighted part of the submission, not a week-3 add-on.

## The Kiro confusion, resolved

Kiro is AWS's AI coding assistant (an IDE) — a tool the team uses *to build* the app faster. It is not the runtime AI that powers the in-app "AI chatbot" feature (that's the $100 team pool + gateway above). Those are two separate things:

- **Kiro (the $1000/person credit)** → developer productivity. Spent as "vibe requests" (~$0.04, ordinary chat/code prompts) and "spec requests" (~$0.20, executing a task straight from a written spec). 4 people × 1000 credits is a large budget for a 3-week hackathon — the team won't run out; the real task is using it well, not rationing it.
- **The report-writing chatbot itself** runs against the organizer-provided gateway (see Update section above for the concrete wiring).

### How to actually use the Kiro credits
1. Day 1 priority: write the three steering docs (`product.md`, `tech.md`, `structure.md`) describing the service-report problem, the React+TS/Go/Postgres stack, and repo layout — update `tech.md` once the Lightsail + gateway details above are locked in. This is what makes every later Kiro request land on-target instead of generic — biggest single lever on both credit efficiency and speed.
2. For each "big bones" item (auth+roles, report rendering/export, template engine, central management/history), write a short requirements.md/design.md first and let Kiro generate tasks.md, then execute via spec requests. One well-specced spec request replaces many trial-and-error vibe requests.
3. Add hooks early: run tests/lint on save, regenerate shared TS types from the Go API on change, and enforce the mobile-UI rules (contrast, tap-target size) automatically given the field-conditions requirement.
4. Start in Supervised mode while the Go+React combo and conventions are still being established; move to Autopilot once specs and hooks are solid, to get scaffolding (CRUD endpoints, form components) essentially free.
5. Have the team split Kiro spend so the plumbing (auth, middleware, export, admin dashboard) gets built fast and cheaply, freeing human attention for the chatbot/agent — the part that's hardest to spec away and most heavily judged.

## Architecture feedback

- **DB/hosting:** see Update section — Lightsail-managed Postgres + Lightsail hosting (superseded the earlier RDS/Aurora/S3 recommendation).
- **Build the agent as a real agent, not a chat wrapper.** Use the gateway with tool-calling (manual JSON-parse pattern, per the Update section) so the chatbot can call functions like "create report draft," "pull past job history," "flag missing field" — that's what the "Best Agents Use" award is actually looking for.
- **Re-sequence: move the AI feature earlier.** Right now the plan builds all the CRUD/UI plumbing first and bolts the AI on in week 2–3. For a hackathon literally about agents, that's backwards risk allocation — if time runs short, the differentiator is what gets cut or rushed. Get a rough end-to-end slice of the chatbot working against mocked data in week 1, in parallel with the "big bones," so week 3 is polish, not first implementation. The starter kit's `weather_demo.py` is a fast way to get a working tool-calling loop against the real gateway on day one.
- **De-scope the drag-and-drop template engine, or use a library.** A LinkedIn-style block-based template builder is a substantial product on its own. Consider a JSON-schema-driven form renderer plus an existing drag-and-drop library (e.g. dnd-kit) instead of building the editor from scratch, or ship a fixed set of report templates for the MVP and make "customize template" a stretch goal.
- **Merge the central management system with the agent's data source.** "Past jobs, history data summary" is exactly the context an agent needs — build it as the context source for the chatbot rather than a separate isolated admin screen. Cuts duplicate work.
- **Clarify "Middleware."** As written it's vague (API gateway? auth middleware? a queue between services?) — worth nailing down before week 1 estimates are trusted.
- **Consider offline-first for the mobile UI.** The problem statement says techs write reports *after* traveling to the next job — implying spotty connectivity. Even a lightweight local-draft-then-sync design would directly address the stated problem and likely stand out on "practical, deployment-ready."

Note: the "de-scope the template engine" point above was superseded on 2026-09-09 — see `product-plan.md`, where the team clarified the template builder is core (workers need to freely customize templates, and the agent fills in that same template's blanks), not a cut feature.
