# Routing

Routing is a dispatch-and-oversight agent that sits between an
orchestrator-style caller (see [`examples/orchestrator`](../orchestrator))
and a pool of coding sub-agents. Given a scoped task it:

1. decides which sub-agent(s) and model(s) fit the task,
2. dispatches and supervises those sub-agents to completion,
3. reviews their resulting work itself, and
4. reports a summary and verdict back upstream.

It never writes or edits code, prose, or any file itself — every write/edit
tool call is denied at the policy layer (see "Enforcing the write/edit
constraint" below), not just discouraged by the prompt.

Run it with a configured OpenAI-compatible / gateway provider:

```bash
omnigent run examples/routing
```

## Why the bundle has this shape

The authoritative agent-image specification is
[`omnigent/spec/AGENTSPEC.md`](../../omnigent/spec/AGENTSPEC.md): a bundle is
a directory whose only required file is `config.yaml`, with optional
`skills/`, `tools/`, and recursive `agents/` directories. The compatible
single-file YAML reference in
[`docs/AGENT_YAML_SPEC.md`](../../docs/AGENT_YAML_SPEC.md) documents the
executor, prompt, tools, OS access, and validation workflow used here.

This bundle follows the multi-file layout and `tools.agents` sub-agent
declaration used by
[`examples/polly/config.yaml`](../polly/config.yaml), which dispatches its
`claude_code` / `codex` / `pi` workers the same way (each a sibling
`agents/<name>/config.yaml`) — see that file's `tools.agents` list and the
`agents/claude_code/config.yaml`, `agents/codex/config.yaml`,
`agents/pi/config.yaml` bundles next to it. Routing declares the same three
workers (`agents/claude_code/`, `agents/codex/`, `agents/pi/`), each an
almost verbatim copy of Polly's worker configs — same harnesses
(`claude-native`, `codex-native`, `pi`), same IMPLEMENT / REVIEW / EXPLORE
contract — with the prompt's identity text pointed at "the routing agent"
instead of "the polly orchestrator" and a note that Routing reviews their
report itself.

Routing differs from Polly in two deliberate ways:

- **`spawn: false`.** Polly sets `spawn: true` so it can author and launch
  brand-new custom agent configs on the fly (`sys_session_create`). Routing
  only ever dispatches its three declared workers, so it gets no
  `sys_session_create` and `guardrails.policies.spawn_bounds.dispatch_tools`
  lists only `sys_session_send`.
- **Review is Routing's own job, not just a cross-vendor sub-agent's.**
  Polly's `cross-review` skill always hands a diff to a *different-vendor*
  sub-agent for the final verdict. Routing may still dispatch a `review`
  sub-agent for a second opinion on a hard task, but per this task's
  requirement it always forms and reports its **own** verdict from the
  implementer's report (and any `gh pr view` / `git log` it reads) before
  answering upstream.

## Enforcing the "never write or edit" constraint

Routing needs read access to review a sub-agent's reported diff (`gh pr
view`, `git log`, `git diff`), so — unlike the fully tool-free
[`examples/orchestrator`](../orchestrator), which has no `os_env` at all —
Routing declares `os_env` with `sandbox: {type: none}`. The write/edit
boundary is instead enforced at the **policy layer**, mechanically, the same
"mechanism-layer enforcement — runner-side tool gate, no server change" style
Polly's own `guardrails` comment uses in
[`examples/polly/config.yaml`](../polly/config.yaml) — see
[`docs/POLICIES.md`](../../docs/POLICIES.md) for how spec-level policies like
this one are evaluated:

```yaml
guardrails:
  policies:
    read_only_os:
      type: function
      on: [tool_call]
      function:
        path: omnigent.inner.nessie.policies.read_only_os
```

[`omnigent.inner.nessie.policies.read_only_os`](../../omnigent/inner/nessie/policies.py)
is a built-in factory that DENIES `sys_os_write` / `sys_os_edit` and the
Claude/Codex/Pi native `Write` / `Edit` / `MultiEdit` aliases at the tool-call
gate, while leaving reads, searches, and shell untouched — its own docstring
names exactly this use case: "agents whose contract is to investigate and
report, never to change code." Routing's `blast_radius` policy keeps the
default `gate_pushes: true` (unlike Polly's unattended `gate_pushes: false`),
since Routing itself should never push or merge anything — only its
sub-agents do, from their own worktrees.

## Model identifier

Routing's own brain is pinned to **`gpt-5.6-sol`** via the
`openai-agents-sdk` harness (multi-model / GPT-family — see
[`omnigent/model_override.py`](../../omnigent/model_override.py), which
notes `openai-agents` "is intentionally NOT in [the codex single-vendor]
set: ... the harness is multi-model like pi and accepts any validated id").

**This id is an assumption, flagged for correction.** `gpt-5.6-sol` is not
one of the curated static ids this repo's own code currently lists anywhere
— the curated codex/gateway catalog in
[`omnigent/model_catalog.py`](../../omnigent/model_catalog.py) only lists
`("gpt-5.5", "gpt-5.4", "gpt-5.4-mini")` for the `codex` subscription CLI. I
inferred the spelling `gpt-5.6-sol` from this codebase's existing id
conventions (a bare `gpt-<major>.<minor>` vendor id, optionally suffixed —
see the `-mini` / `-codex` suffixes throughout
[`omnigent/inner/codex_executor.py`](../../omnigent/inner/codex_executor.py)
and [`omnigent/cursor_native.py`](../../omnigent/cursor_native.py)) and from
[`omnigent/model_override.py`](../../omnigent/model_override.py)'s model-id
charset (`_MODEL_ID_RE`), which accepts it. Because it isn't curated
anywhere in-repo, a human should confirm the real id (and whether it needs a
`databricks-` gateway prefix, per
[`omnigent/model_override.py`](../../omnigent/model_override.py)'s
`normalize_model_for_provider`) before this agent is run against a live
provider — an unresolvable id fails loud at dispatch/launch rather than
silently, per that same module's family-mismatch guard, but that only
catches it at runtime, not at config-authoring time.
