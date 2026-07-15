# Routing

Routing is a dispatch-and-oversight agent that sits between an
orchestrator-style caller (see [`examples/orchestrator`](../orchestrator))
and a pool of coding sub-agents. Given a scoped task it:

1. decides which sub-agent(s) and model(s) fit the task,
2. dispatches and supervises those sub-agents to completion,
3. reviews their resulting work itself, and
4. reports a summary and verdict back upstream.

It never writes or edits code, prose, or any file itself. It has no `os_env`
at all, so `sys_os_read` / `sys_os_write` / `sys_os_edit` / `sys_os_shell`
and terminals are never registered as tools it can call in the first place —
there is no mechanism for it to touch the filesystem, let alone write to it
(see "Enforcing the never write or edit constraint" below). It reviews
sub-agent work from the diffs, reports, and command output its sub-agents
include as text in their own deliverable.

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
coding workers the same way (each a sibling `agents/<name>/config.yaml`).
Routing declares four workers: `claude_code`, `codex`, `antigravity`, and `pi`
(see `agents/claude_code/config.yaml`, `agents/codex/config.yaml`,
`agents/antigravity/config.yaml`, `agents/pi/config.yaml` bundles), each an
almost verbatim copy of Polly's worker configs — same harnesses
(`claude-native`, `codex-native`, `antigravity-native`, `pi`), same IMPLEMENT / REVIEW / EXPLORE
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
  requirement it always forms and reports its **own** verdict — reading only
  the diff, PR description, and any `gh pr view` / `git log` output the
  sub-agent chose to include as text in its report, since Routing has no
  shell of its own to run those commands directly — before answering
  upstream.

## Enforcing the "never write or edit" constraint

An earlier draft of this bundle declared `os_env` with `sandbox: {type:
none}` (an unsandboxed shell) and relied only on a `read_only_os` policy to
deny the *named* write/edit tool calls. That is not sufficient: a `sandbox:
none` `sys_os_shell` can still mutate the filesystem through commands that
aren't a `sys_os_write` / `sys_os_edit` call at all — `sed -i`, `tee`,
`echo … > file`, `git apply`, `python -c "open(...).write(...)"`, and so on —
and `read_only_os` only pattern-matches specific tool names, not shell
command content, so none of that would have been caught. Genuinely
read-only shell would need an allow-list of specific commands (`git log`,
`git diff`, `gh pr view`, `cat`, `ls`, `grep`, …) enforced against the actual
command string, and no such policy exists in this codebase today.

Rather than invent and rely on a new, unreviewed command-allowlist policy for
a hard "never write" contract, Routing declares **no `os_env` at all** — the
same choice [`examples/orchestrator`](../orchestrator) makes. Per
[`docs/AGENT_YAML_SPEC.md`](../../docs/AGENT_YAML_SPEC.md) ("Declare `os_env`
only for agents that need local file/shell tools"), omitting the block means
`sys_os_read` / `sys_os_write` / `sys_os_edit` / `sys_os_shell` are never
registered as tools Routing can call, and it gets no terminals either. There
is no mechanism left for it to touch a file, write or otherwise — not a
narrower shell, no shell at all. Routing reviews sub-agent work purely from
the diff, PR description, and any `gh pr view` / `git log` output its
sub-agents choose to include as text in their own IMPLEMENT / REVIEW report
(see the prompt's REVIEW section) — the same shape as Polly's `cross-review`
skill, which hands a reviewer sub-agent a diff + contract as text rather than
worktree access.

`guardrails.policies.read_only_os` is kept anyway, as defense-in-depth rather
than the primary guard:

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
gate — its own docstring names exactly this use case: "agents whose contract
is to investigate and report, never to change code." With no `os_env`
declared, none of those tools are normally registered for Routing to begin
with, so this policy currently has nothing to catch; it stays in the bundle
so that if a future edit adds `os_env` (or a native harness surfaces its own
write tool) without revisiting this section, the write/edit boundary is still
denied at the policy layer instead of silently reopening. Polly's
`blast_radius` policy (which gates outward/destructive shell like `git push`)
is not included here at all, since Routing has no shell tool for it to gate.

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
provider.

To be precise about what does and doesn't catch a wrong id here: `gpt-5.6-sol`
is Routing's own top-level `executor.model`, not a per-dispatch sub-agent
override, so `model_override.py`'s `validate_model_override` /
`model_family_mismatch` guards don't run against it at all — those only fire
"at the `sys_session_send` dispatch gate" (per that module's own docstrings),
i.e. when Routing dispatches a worker with an explicit `args.model`. Neither
[`omnigent/spec/parser.py`](../../omnigent/spec/parser.py) (`_parse_executor`
just stores `executor.model` as a string) nor
[`omnigent/spec/validator.py`](../../omnigent/spec/validator.py) /
[`omnigent/spec/_omnigent_compat.py`](../../omnigent/spec/_omnigent_compat.py)
(`validate_omnigent_executor` checks only `executor.config.harness`) validate
the *content* of a top-level `executor.model` string — confirmed by running
this bundle through `omnigent.spec.parser.parse` +
`omnigent.spec.validator.validate` below, which reports it as valid
regardless of whether `gpt-5.6-sol` actually resolves to a real model. So an
incorrect id here is not caught by schema validation or by any dispatch-time
guard; it would only surface as a runtime failure from the resolved
OpenAI-compatible / gateway provider (e.g. a "model not found"-style API
error) the first time Routing is actually run against live credentials.
