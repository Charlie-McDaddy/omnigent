---
name: harness-integration-guide
description: Reference guide for building new Omnigent harness integrations — covers the full feature matrix (MCP, model override, auth, streaming, policies, interrupt, concurrency, transcript resume, compaction, reasoning, images) with implementation notes and capability tiers.
---

# Harness integration guide

This skill describes the **feature matrix** every Omnigent harness must
consider. Use it when planning, reviewing, or implementing a new harness
(SDK in-process, CLI subprocess, or ACP subprocess).

## Capability matrix

Each harness is evaluated across the following dimensions:

| Capability | What it means | Priority |
|---|---|---|
| **Connects to Omnigent MCP** | Harness exposes/consumes tools via the MCP protocol (stdio `serve-mcp` or in-proc SDK MCP server) | P0 for SDK harnesses; native harnesses may use non-MCP bridges |
| **Model override** | User can select a model via `--model` / config; some harnesses are vendor-locked (e.g. Claude-only, GPT-only, Gemini-only) | P0 |
| **Auth** | How credentials are obtained — API key, gateway token, vendor CLI login, OAuth, etc. | P0 |
| **Streaming** | Harness forwards token-level or delta-level streaming to the Omnigent forwarder | P0 |
| **Policies / Elicitation** | How the harness gates tool use — `canUseTool ASK`, `request_permission`, 2-stage cards, pre-tool hooks, or policy DENY | P0 for web UI |
| **Interrupt** | User can cancel a running turn mid-stream | P1 |
| **Live queue (concurrent)** | Multiple turns can be queued and processed concurrently | P1 |
| **Tool-boundary steer** | Omnigent can inject steering text at tool-call boundaries | P1 |
| **Resume/fork from Omnigent transcript** | Rebuild a conversation from a stored Omnigent transcript (replay history, seed prompt, or vendor session ID) | P1 |
| **Compaction** | Long conversations are compacted; harness surfaces `CompactionComplete` events | P2 |
| **Reasoning** | Model reasoning/thinking tokens are forwarded | P2 |
| **Images** | Image content (screenshots, diagrams) is forwarded — full binary, path reference, or text-flattened | P2 |

## Implementation patterns

### Transport types

| Type | Description | Examples |
|---|---|---|
| **SDK in-process** | Harness runs inside the Omnigent Python process via a vendor SDK | claude-sdk, cursor, antigravity, copilot, openai-agents |
| **CLI subprocess** | Harness spawns a vendor CLI binary and communicates via stdout/stdin (JSONL, stream-json, or shell hooks) | codex, pi, kimi, hermes |
| **ACP subprocess** | Harness uses the Agent Communication Protocol over a subprocess | qwen, goose |

### MCP connectivity

- **In-proc SDK MCP server** — the harness runs an MCP server in-process and the SDK connects to it directly (e.g. claude-sdk).
- **stdio `serve-mcp`** — native harnesses connect via `stdio serve-mcp` to the Omnigent MCP server.
- **Non-MCP bridges** — many harnesses use vendor-specific tool bridging: `dynamicTools` RPC (codex), SDK `custom_tools` (cursor), SDK `FunctionTool` (openai-agents), TCP socket (pi), shell hooks (hermes), SDK in-proc tools (antigravity), SDK tool handlers (copilot).

### Policies / elicitation strategies

| Strategy | How it works | Harnesses |
|---|---|---|
| `canUseTool ASK` | Omnigent asks the model whether a tool call should proceed; model responds with ASK to surface to user | claude-sdk, codex, openai-agents |
| `request_permission` | ACP-native permission request flow | qwen, goose |
| 2-stage + card | Two-phase approval with a UI card | cursor |
| Pre-tool hook | Shell hook runs before each tool call; can DENY | hermes (non-native), pi-native, kimi-native |
| Policy DENY | Omnigent policy engine denies disallowed calls | antigravity |
| Pre-gated | Tools are pre-approved; native tools bypass gating | copilot |

### Resume / fork strategies

| Strategy | How it works | Harnesses |
|---|---|---|
| Full history replay | Replays the entire message history into a fresh thread/session | codex, cursor, openai-agents |
| History prefix replay | Replays a prefix of the history into a fresh session | pi |
| Text-prefix replay | Injects a text summary/prefix of prior history | qwen, goose |
| Prompt seeding | Seeds prior history into the system prompt on rebuild | antigravity |
| Native rebuild | Vendor CLI natively supports resume/fork from transcript | claude-native, codex-native |
| Vendor session ID | Relies on the vendor's own session persistence (no Omnigent-side rebuild) | kimi, hermes, copilot |

### Auth patterns

| Pattern | Examples |
|---|---|
| Anthropic API key / Databricks gateway | claude-sdk |
| Vendor API key (direct) | cursor (Cursor API key), antigravity (Gemini key) |
| Vendor CLI login / config file | hermes, kimi, goose, qwen, pi |
| OAuth / GitHub token | copilot (GitHub PAT with Copilot permission) |
| Gateway + fallback | codex (Databricks gateway / codex auth.json), pi (gateway / API keys) |

## Native harness capabilities

Native harnesses wrap a vendor's own TUI or server and mirror output into
Omnigent. They have a separate feature set:

| Capability | What it means |
|---|---|
| **Transport** | How the native harness communicates — tmux TUI, app server, HTTP/SSE, file-inject TUI |
| **Streaming (forwarder)** | `deltas` (token-level) vs `complete-only` (full response after completion) |
| **Bidirectional sync** | TUI output mirrors into Omnigent conversation |
| **Session-cmd sync** | Supports `clear`, `fork`, `resume`, `switch` commands from Omnigent |
| **Policies** | Whether the native harness can gate tool calls (mirror+reply, permission.v2, hook DENY, or none) |

## Checklist for a new harness

When implementing a new harness, ensure the following:

1. **P0 — must have for launch:**
   - [ ] Model override works (or document vendor lock-in)
   - [ ] Auth is configured and documented (setup flow in `omni setup`)
   - [ ] Streaming forwards to the Omnigent forwarder
   - [ ] Tool bridging works (MCP or vendor-specific)
   - [ ] Policy / elicitation strategy is implemented for web UI

2. **P1 — expected for production use:**
   - [ ] Interrupt cancels the running turn
   - [ ] Tool-boundary steering injects correctly
   - [ ] Resume/fork rebuilds conversation from Omnigent transcript

3. **P2 — nice to have:**
   - [ ] Compaction is surfaced (`CompactionComplete` events)
   - [ ] Reasoning tokens are forwarded
   - [ ] Images are forwarded (full binary preferred; path or text-flattened acceptable)

4. **Testing:**
   - [ ] Unit tests cover tool bridging, auth, model routing
   - [ ] E2E skill exists for manual smoke-testing against a live server
   - [ ] Mock LLM tests cover the happy path without real API calls
