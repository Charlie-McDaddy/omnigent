# Opencode harness support + a unified "add-a-harness" interface

Status: **Draft / proposal** · Branch: `feat/opencode-harness` · Author: orchestrated by polly (multi-agent investigation)

This document answers two questions:

1. **How do we add [opencode](https://opencode.ai/) ([anomalyco/opencode](https://github.com/anomalyco/opencode)) as a harness in omnigent?**
2. **Can we "unify" the harness-addition process into a clean interface you implement to add a new harness?**

It is grounded in four parallel read-only investigations (ultrathink) of the omnigent tree and the opencode source (`/tmp/opencode`). File references are `path:line` against the working tree at the time of writing; treat line numbers as approximate anchors.

---

## TL;DR

- A "harness" today is a **named coding-agent backend run as a per-conversation subprocess** that exposes one factory, `create_app() -> fastapi.FastAPI`. The real extension point is an **inner `Executor`** (`omnigent/inner/executor.py:496`) with one required method `run_turn(...) -> AsyncIterator[ExecutorEvent]`, wrapped by an `ExecutorAdapter` (`omnigent/inner/_executor_adapter.py:137`).
- There are **two structural families** of harness:
  - **In-process SDK executors** — `cursor`, `antigravity`: import a vendor **Python** SDK and yield events directly from `run_turn`.
  - **Native-server harnesses** — `claude-native`, `codex-native`, `pi-native`: spawn an **external agent process/server**, keep per-session **bridge state**, **forward** its event stream into Omnigent, and inject prompts via the native protocol.
- **opencode fits the native-server family — it is a near-twin of `codex-native`.** opencode ships `opencode serve` (local HTTP server) + an **SSE** event stream + REST endpoints for create/prompt/abort/permission-reply, with persisted, resumable sessions and per-prompt model pinning. The only material difference from codex-native is the **transport** (codex = JSON-RPC/WebSocket; opencode = HTTP + SSE) and that opencode's official **SDK is JS/TS-only** (so we talk to `opencode serve` over HTTP directly from Python).
- Adding a harness today touches **~25-50 files across ~10 categories** (core executor/harness, registry, spec, CLI, onboarding/auth, readiness/install, runtime workflow, runner, model catalog, web/repl pickers, tests). Much of this is **copy-paste boilerplate** and several **scattered registries** that should be collapsed.
- **Recommendation:** implement opencode by **mirroring `codex-native`** first (de-risks the feature and gives us a *second* concrete native-server example), then **extract a shared `NativeServerHarness` base + a single harness-registration descriptor** and migrate both opencode and codex-native onto it. You cannot design the right abstraction from one example; with codex **and** opencode in hand, the correct seams are obvious.

---

## Part 1 — How harnesses work today

### 1.1 The core contract

Every harness is realized at runtime as a **subprocess** that serves a small slice of the Omnigent REST API. The single contract is:

```
create_app() -> fastapi.FastAPI      # served by the harness subprocess
```

served endpoints (from the scaffold): `GET /health`, `POST /v1/sessions/{cid}/events` (message | interrupt | tool_result | approval | policy_verdict). See `omnigent/inner/_scaffold.py` (`HarnessApp`, `.build()`, abstract `run_turn(request, ctx)`).

The thin `omnigent/inner/<h>_harness.py` module is just: build an inner executor → wrap it in `ExecutorAdapter` → return `adapter.build()` (e.g. `omnigent/inner/cursor_harness.py:142`, `omnigent/inner/antigravity_harness.py:75`). Config is passed in via `HARNESS_<H>_*` environment variables.

### 1.2 The real extension point: the inner `Executor`

`omnigent/inner/executor.py:496` defines the interface a new backend implements:

```python
class Executor:
    async def run_turn(self, messages, tools, system_prompt,
                       config: ExecutorConfig | None = None
                       ) -> AsyncIterator[ExecutorEvent]: ...   # REQUIRED (:502)
    def supports_streaming(self) -> bool                         # default False
    def supports_tool_calling(self) -> bool                      # default True
    def handles_tools_internally(self) -> bool                   # default False  (load-bearing)
    def max_context_tokens(self) -> int | None                   # default None
    async def close_session(self, session_key) -> None           # default no-op
    async def interrupt_session(self, session_key) -> bool       # default False
    async def enqueue_session_message(self, session_key, content) # default False
    def supports_live_message_queue(self) -> bool                # default False
    def supports_tool_boundary_interrupt(self) -> bool           # default False
    def supports_stepwise_internal_turns(self) -> bool           # default False
    async def close(self) -> None                                # default no-op
```

`ExecutorConfig` (`:70`) carries `model`, `temperature`, `max_tokens`, and an `extra` dict (e.g. `extra["reasoning_effort"]`). The inner event types (`ExecutorEvent` subclasses): `TextChunk`, `ReasoningChunk`, `ToolCallRequest`, `ToolCallComplete`, `TurnComplete`, `TurnCancelled`, `ExecutorError`.

`handles_tools_internally() == True` (cursor, claude-sdk, codex, pi, and the native harnesses) means the backend runs the LLM tool loop itself and the adapter must not re-dispatch observed events.

### 1.3 The two families

| | In-process SDK executor | Native-server harness |
|---|---|---|
| Examples | `cursor`, `antigravity` | `claude-native`, `codex-native`, `pi-native` |
| Backend | vendor **Python** SDK imported in-proc | external CLI/agent **process/server** |
| Where events come from | yielded directly inside `run_turn` | a **forwarder** consumes the native event stream and posts Omnigent events |
| Code location | `omnigent/inner/<h>_executor.py` + `<h>_harness.py` | top-level `omnigent/<h>_native*.py` (app-server, bridge, forwarder, state, hook) **plus** a small `inner/<h>_native_executor.py` that only injects web turns |
| Terminal "take over" | n/a (pi-native is headless) | a separate TUI process attaches to the server (claude/codex) |

Evidence: cursor drives `cursor_sdk` `AsyncAgent` and streams `run.messages()` (`omnigent/inner/cursor_executor.py:466,556`); antigravity wraps `google-antigravity` via `conversation.send`/`receive_steps()` (`omnigent/inner/antigravity_executor.py:572`). codex-native spawns `codex app-server` and bridges it (see Part 2).

### 1.4 The "two-`Executor`-ABC" tax

There are **two unrelated classes both named `Executor`** with different `run_turn` signatures and overlapping-but-different event vocabularies:

- `omnigent/inner/executor.py:496` — harness-facing (plain class; `run_turn(..., config)`).
- `omnigent/runtime/executors/base.py:444` — workflow/in-process-facing (`abc.ABC`; `from_spec()`, `run_turn(..., llm_config, context)`).

`SupervisorExecutor` (`omnigent/inner/databricks_supervisor_executor.py:272`) bridges the two by translating `Runtime*` events back to inner events. This duplicate-vocabulary translation is pure overhead and is a prime unification target (see Part 5).

---

## Part 2 — codex-native, in detail (the template opencode should follow)

Verdict from the comparison investigation: **opencode's natural integration is the codex-native pattern, not the cursor/antigravity in-process-SDK pattern.**

codex-native's machinery (all reusable concepts for opencode):

1. **Per-session server process.** `codex app-server --listen ws://127.0.0.1:<port>` started with `asyncio.create_subprocess_exec`, private `CODEX_HOME` per session, stdout/stdin to DEVNULL, stderr captured (`omnigent/codex_native_app_server.py:560,570,575`). Local paths prefer loopback `ws://127.0.0.1:<port>` (`omnigent/codex_native.py:968`, `omnigent/runner/app.py:1087`).
2. **Transport = JSON-RPC over WebSocket.** Client connects via Unix socket or TCP ws, sends `{id, method, params}`, treats non-response messages as events (`omnigent/codex_native_app_server.py:257,295,345,422`).
3. **Bridge state** (per-session file): Omnigent session id ↔ Codex thread id ↔ transport ↔ active turn id ↔ private `CODEX_HOME` (`omnigent/codex_native_bridge.py:46,63,303`).
4. **Prompt injection via the executor**, not the terminal: `CodexNativeExecutor.run_turn` reads bridge state and calls app-server `turn/start` (new turn) or `turn/steer` (mid-turn) (`omnigent/inner/codex_native_executor.py:143,196,216`).
5. **Forwarder**: `supervise_forwarder` consumes `client.iter_events()` and posts Omnigent session events, handling `turn/started|completed|failed`, token usage, plan/settings updates, text deltas, and `item/completed` translation (`omnigent/codex_native_forwarder.py:1238,1617,3201`).
6. **Cancel/abort**: app-server `turn/interrupt` with `threadId` + active `turnId` (`omnigent/runner/app.py:6366`, `omnigent/inner/codex_native_executor.py:132`).
7. **Resume**: Omnigent `external_session_id` is the Codex thread id; preload via `thread/resume`; TUI relaunch as `codex resume --remote <url> <thread_id>` (`omnigent/codex_native.py:914,1002`, `omnigent/codex_native_app_server.py:1488`).
8. **Models**: initial model pinned into per-session `config.toml`; TUI `/model` changes mirrored back via `external_model_change`; live web-driven model change is **not** implemented for codex (shipped codex lacks a programmatic switch — `omnigent/runner/app.py:9503`).
9. **Permissions/elicitation (two layers)**: (a) policy hooks registered into `CODEX_HOME/hooks.json` as `PreToolUse`/`PostToolUse`/`UserPromptSubmit` commands that shell out to `omnigent.codex_native_hook` which POSTs to `/v1/sessions/{id}/policies/evaluate` (`omnigent/codex_native_app_server.py:799`, `omnigent/codex_native_hook.py:67,142`); (b) server→client JSON-RPC approval requests (`item/tool/requestUserInput`, `item/commandExecution/requestApproval`, …) forwarded to `/hooks/codex-elicitation-request` and answered back (`omnigent/codex_native_forwarder.py:2564,2638`).
10. **Reasoning-effort live injection**: only implemented for claude-native; others return `204` (`omnigent/runner/app.py:9480`).

---

## Part 3 — opencode's integration surface

**Caveat:** `/tmp/opencode` is a Bun/TS monorepo mid-migration between **v1** (shipping `opencode-ai`, `packages/opencode`) and **v2 preview** (`packages/cli` + `packages/server` + `packages/core`). The single `packages/sdk/openapi.json` (OpenAPI 3.1, ~150 paths) unifies both legacy unprefixed routes and `/api/*` routes; the shipped `run`/`serve` already target the v2 SDK surface. **We must pin a specific opencode version.**

### 3.1 Programmatic surfaces (all built on one HTTP server)

| Mode | Entry | Notes |
|---|---|---|
| Headless one-shot | `opencode run [msg] --format json` | boots in-process server, drives via SDK, emits JSON events on stdout |
| HTTP server | `opencode serve [--port --hostname --cors]` | default `127.0.0.1:4096`; **this is what we drive** |
| JS/TS SDK | `@opencode-ai/sdk` (`createOpencodeServer` spawns `serve`, returns `{url, close()}`) | **JS-only** — not usable from Python directly |
| ACP stdio | `opencode acp` | Agent Client Protocol over stdio nd-JSON; an alternative transport |

The TUI is itself a client of the server. `createOpencodeServer` parses the stdout line `opencode server listening on http://...` — we can do the same from Python.

### 3.2 Endpoints + events (the integration contract)

| Method | Path | Purpose |
|---|---|---|
| GET | `/event` | **SSE event stream** (primary) |
| POST | `/session` | create session (`{parentID?, title?, agent?, model?, permission?}`) |
| GET | `/session` / `/session/{id}` | list / fetch |
| POST | `/session/{id}/message` | **prompt + wait** (`{messageID?, model?, agent?, system?, tools?, parts}`) |
| POST | `/session/{id}/prompt_async` | prompt, no wait → 204 |
| POST | `/session/{id}/abort` | **cancel current turn** |
| POST | `/session/{id}/fork` | branch a session |
| GET | `/session/{id}/message` | replay history |
| POST | `/permission/{requestID}/reply` | approve/deny (`once`/`always`/`reject`) |
| GET | `/agent`, `/skill`, `/command`, `/provider`, `/config` | capability/config discovery |

Event types: legacy family `message.updated`, `message.part.updated`, `session.status`/`session.idle`, `permission.asked`; richer v2 family `session.next.text.delta`, `session.next.tool.called`, etc. Core loop = create → prompt → consume SSE until `session.status` idle → `abort` to cancel → `permission.reply` to approve.

### 3.3 Sessions / models / permissions

- **Sessions** persisted under XDG data dir (`~/.local/share/opencode`; SQLite + legacy files), resumable by id, forkable.
- **Models** pinnable per prompt/session via `model` param (better than codex — enables live model change).
- **Permissions**: `permission.asked` event → `POST /permission/{id}/reply` with `once|always|reject`. Maps cleanly to Omnigent approval cards / policy verdicts.

---

## Part 4 — Proposed opencode harness (Track A: the feature)

Mirror codex-native, swapping the transport. New/changed code:

**Core (new):**
- `omnigent/opencode_native.py` — local launch orchestration (start Omnigent server, create/load session, spawn `opencode serve`, optionally start TUI, start forwarder), the generated wrapper spec (`executor: {harness: "opencode"}`).
- `omnigent/opencode_native_server.py` — process manager: spawn `opencode serve --hostname 127.0.0.1 --port <p>`, parse listening URL from stdout, private data dir per session (env: `XDG_DATA_HOME`/`OPENCODE_*`), health-check, teardown.
- `omnigent/opencode_native_client.py` — minimal **HTTP + SSE** client generated/derived from `packages/sdk/openapi.json` (create/prompt/abort/fork/messages/permission-reply + `/event` SSE consumer). Replaces codex's WS-JSON-RPC client.
- `omnigent/opencode_native_bridge.py` — bridge state (Omnigent session id ↔ opencode session id ↔ server URL ↔ active message/turn id).
- `omnigent/opencode_native_forwarder.py` — consume SSE `/event`, translate `message.part.updated`/`session.status`/`permission.asked`/tool events → Omnigent `external_*` events.
- `omnigent/inner/opencode_native_executor.py` — `run_turn` injects web turns via `POST /session/{id}/message` (and abort via `/session/{id}/abort`).
- `omnigent/inner/opencode_native_harness.py` — `create_app()` wrapping the executor in `ExecutorAdapter`.

**codex → opencode mapping:**

| Concern | codex-native | opencode |
|---|---|---|
| spawn | `codex app-server --listen ws://…` | `opencode serve --port …` |
| transport | JSON-RPC / WebSocket | HTTP REST + **SSE** |
| new turn | `turn/start` | `POST /session/{id}/message` |
| steer | `turn/steer` | (open Q: `prompt_async` while running? or queue) |
| events | `client.iter_events()` | SSE `GET /event` |
| cancel | `turn/interrupt` | `POST /session/{id}/abort` |
| resume | `thread/resume` + `external_session_id` | session id + `GET /session/{id}/message` replay |
| permission | hooks.json + elicitation JSON-RPC | `permission.asked` → `POST /permission/{id}/reply` |
| model pin | per-session `config.toml` | `model` on create/prompt (live change feasible) |

**Wiring (the scattered registries — see Part 5/Appendix):** register `opencode` in `_HARNESS_MODULES` (`omnigent/runtime/harnesses/__init__.py`), the `OMNIGENT_HARNESSES` allowlist (`omnigent/spec/_omnigent_compat.py`), `harness_aliases.py`, `model_catalog.py` (provider/models via `models.dev`), `ap-web/src/lib/agentLabels.ts` (+ `nativeCodingAgents.ts` if terminal-attach), readiness (`omnigent/onboarding/harness_readiness.py`), install/extras + CLI setup, runner auto-create + interrupt routes (`omnigent/runner/app.py`), docs (`docs/AGENT_YAML_SPEC.md`), and the standard test matrix.

**Open questions (need answers before/within implementation):**
1. **Version pin + API generation** — which opencode version, and v1 vs v2 routes? (Pin in `pyproject`/install; generate the client from that version's `openapi.json`.)
2. **Terminal "take over" parity** — codex/claude attach a TUI to the running server. Can opencode's TUI attach to an *external* `opencode serve` (so a human can take over in the terminal panel)? If not, opencode launches **headless like pi-native** initially, and terminal-attach is a follow-up.
3. **Mid-turn steering** — does opencode support injecting a message into a running turn (analogous to `turn/steer`), or must we queue until idle?
4. **Auth/providers** — opencode uses `models.dev` + provider config/`auth`; map to omnigent's onboarding (env keys, `provider_config.py`).
5. **Permission granularity** — map opencode `once|always|reject` to omnigent policy verdicts/approval cards.

---

## Part 5 — A unified "add-a-harness" interface (Track B: the cleanup)

The investigations identified three concrete pains, each with a fix:

### Pain 1 — harness-ness is smeared across ~7 registries/dicts
Adding a harness today means editing many disjoint places (registry, allowlist, aliases, model catalog, labels, readiness, install, CLI, docs). **Fix:** one declarative **`HarnessDescriptor`** registered in **one** place (entry-point or a single `register_harness(...)` call), e.g.:

```python
@register_harness
class OpenCodeHarness(HarnessDescriptor):
    name = "opencode"
    aliases = ("oc",)
    family = HarnessFamily.NATIVE_SERVER
    label = "OpenCode"
    executor_factory = build_opencode_executor
    readiness = OpenCodeReadiness        # binary check, version pin
    install = OpenCodeInstall            # pip extra / npm install offer
    auth = OpenCodeAuth                  # provider/key onboarding
    models = OpenCodeModelSource         # models.dev provider mapping
    supports_terminal_takeover = False   # until TUI-attach is confirmed
```

Each scattered registry becomes a **derived view** over the descriptor set (the registry, allowlist, aliases, labels, readiness map are computed, not hand-edited). This is the heart of "an interface you implement to add a harness."

### Pain 2 — the two-`Executor`-ABC fork
Collapse `omnigent/inner/executor.py` and `omnigent/runtime/executors/base.py` to one canonical `Executor` + one event vocabulary (or make one a thin alias), retiring the `SupervisorExecutor` translation layer. High-leverage but higher-risk; can be staged.

### Pain 3 — native-server harness boilerplate (the codex/opencode overlap)
Extract a **`NativeServerHarness`** base that captures the shared lifecycle — *spawn per-session server → bridge state → forwarder loop → executor injects prompts → cancel → permission/elicitation → resume* — parameterized by a small **transport adapter** interface:

```python
class NativeServerTransport(Protocol):
    async def start(self, session) -> ServerHandle      # spawn + discover URL/health
    async def create_session(self, ...) -> str
    async def send_prompt(self, sid, parts, model) -> TurnHandle
    def events(self, sid) -> AsyncIterator[NativeEvent]  # WS frames | SSE
    async def abort(self, sid) -> None
    async def reply_permission(self, req_id, decision) -> None
    async def resume(self, sid) -> None
```

- **CodexWsTransport** = WS-JSON-RPC (existing machinery).
- **OpenCodeHttpTransport** = HTTP + SSE.

The forwarder, bridge, executor-injection, cancel, and resume become **shared** code; only the transport differs. This is the single biggest reuse win and is *only designable now* because we have two examples.

### Plus: a conformance suite + scaffold
- A **harness conformance test** (parametrized over every descriptor) asserting the standard matrix: executor unit, harness `create_app`, spawn-env, readiness, `test_run_harness_without_agent_e2e`, per-harness lifecycle/streaming e2e. Adding a harness = registering a descriptor and passing the suite.
- An optional **`omnigent scaffold-harness <name>`** generator that emits the descriptor + executor stub + test stubs.

---

## Part 6 — Recommended plan, sequencing, risks

### Sequencing (recommended)
1. **Implement opencode mirroring codex-native** (Track A), wired through the existing registries. Ships the feature; produces the second native-server example. *(Open questions in Part 4 resolved here.)*
2. **Extract `NativeServerHarness` + `NativeServerTransport`** (Pain 3) and migrate **both** opencode and codex-native onto it. The diff between the two implementations defines the abstraction precisely.
3. **Introduce `HarnessDescriptor` + single registration** (Pain 1); make the scattered registries derived views; migrate all harnesses. Add the conformance suite + scaffold.
4. **(Optional, staged) collapse the two-`Executor` ABCs** (Pain 2).

Rationale: avoid premature abstraction from one example; deliver value early; let the codex/opencode pair reveal the true seams. Steps 2-3 can each be their own PR; step 4 is independent.

### Alternative sequencings (your call)
- **A. opencode only** — do step 1, defer all unification to a follow-up. Fastest feature; no cleanup.
- **B. interface-first** — do step 3 (descriptor) before opencode, then add opencode as the first consumer. Dogfoods the interface but designs Pain-3 from one example (riskier).
- **C. full program** — steps 1-4 as a coordinated set of PRs.

### Risks / unknowns
- opencode **v1/v2 split** and active churn → pin a version; generate the client from that `openapi.json`; add an integration smoke test.
- **Terminal-takeover parity** uncertain → start headless (pi-native style) if TUI-attach to an external server isn't supported.
- **Mid-turn steer** may be unavailable → queue-until-idle fallback.
- **Two-ABC collapse** (Pain 2) is the riskiest cleanup → keep it separate and optional.
- All implementation is **delegated and cross-vendor-reviewed**; each PR is independently reviewed by a different-vendor agent before a human merges. polly never merges.

---

## Appendix A — "add a harness" extension-point checklist (from git archaeology)

Landing PRs: pi-native `#22` (`3fe0cc1`, 47 files), cursor `#203` (`88de81a`, 28 files), antigravity `#194` (`468a57b`, 26 files), each with auth/install follow-ups (pi `#207`, cursor `#329`, antigravity `#322`/`#311`).

Categories touched (★ = every harness):
- ★ Core: `omnigent/inner/<h>_executor.py` + `omnigent/inner/<h>_harness.py` (the latter is near-identical boilerplate). Native-server harnesses also add top-level `<h>_native*.py` (app-server/bridge/forwarder/state/hook).
- ★ Runtime registry: `_HARNESS_MODULES` in `omnigent/runtime/harnesses/__init__.py`.
- ★ Spec/schema: `omnigent/spec/_omnigent_compat.py` (+ `docs/AGENT_YAML_SPEC.md`).
- ★ CLI setup: `omnigent/cli.py`.
- ★ Onboarding/auth: `omnigent/onboarding/<h>_auth.py` (or `<h>_credentials.py`).
- ★ Readiness/install: `omnigent/onboarding/harness_readiness.py`, `harness_install.py`, `pyproject.toml` extras (+ `uv.lock`).
- Spawn env / runtime: `omnigent/runtime/workflow.py` (cursor/antigravity heavy).
- Runner dispatch/lifecycle: `omnigent/runner/app.py`, `omnigent/runner/tool_dispatch.py` (native harnesses: auto-create + interrupt routes).
- Model wiring: `omnigent/model_catalog.py`, `omnigent/model_override.py`.
- Web/repl pickers + labels: `ap-web/src/lib/agentLabels.ts`, `ap-web/src/lib/nativeCodingAgents.ts`, `omnigent/repl/_resume_picker.py`.
- Server routes/schemas: `omnigent/server/app.py`, `omnigent/server/routes/sessions.py`, `openapi.json` (native-terminal harnesses).
- ★ Tests: `tests/inner/test_<h>_executor.py`, `tests/inner/test_<h>_harness.py`, `tests/runtime/test_<h>_spawn_env.py`, onboarding/readiness/configure tests, `tests/e2e/omnigent/test_run_harness_without_agent_e2e.py`, per-harness lifecycle/streaming e2e.

## Appendix B — investigation provenance

Four parallel read-only sub-agent investigations (ultrathink): (1) harness architecture map, (2) git archaeology of cursor/antigravity/pi additions, (3) opencode integration surface from `/tmp/opencode` + opencode.ai docs, (4) codex-native vs opencode transport comparison. This doc synthesizes their reports; `path:line` anchors are from those reports against the working tree.
