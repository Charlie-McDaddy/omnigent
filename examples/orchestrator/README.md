# Orchestrator

Orchestrator is a deliberately tool-free example agent for planning and review.
It can turn supplied text into an implementation plan or judge a supplied diff
against a supplied contract. It cannot inspect a repository, search the web,
run commands, edit files, write code, or delegate work.

Run it with a configured Claude provider:

```bash
omnigent run examples/orchestrator
```

## Why the bundle has this shape

The authoritative agent-image specification is
[`omnigent/spec/AGENTSPEC.md`](../../omnigent/spec/AGENTSPEC.md). It defines a
bundle as a directory whose only required file is `config.yaml`, with optional
`skills/`, `tools/`, and recursive `agents/` directories. The parser and
validator implementations named there are the source of truth. The compatible
single-file YAML reference in
[`docs/AGENT_YAML_SPEC.md`](../../docs/AGENT_YAML_SPEC.md) documents the
executor, prompt, tools, OS access, terminals, and validation workflow used by
the bundled examples.

This bundle follows the layout and `executor.type: omnigent` convention used by
[`examples/polly/config.yaml`](../polly/config.yaml), but intentionally omits
Polly's tools, sub-agents, OS environment, terminals, and skills. It also sets
`skills: none`, `async: false`, `spawn: false`, and `timers: false` so host
skills and indirect work-dispatch capabilities are unavailable. Because
Omnigent always registers session-read helpers, a zero-call
`max_tool_calls_per_session` guardrail denies every attempted tool call. Its
interaction modalities are text-only.

## Model identifier

The model is pinned with the canonical ID `claude-fable-5`. Omnigent's static
Claude catalog lists that ID in
[`omnigent/model_catalog.py`](../../omnigent/model_catalog.py), while the
Databricks gateway shim and its tests explicitly recognize
`databricks-claude-fable-5` in
[`omnigent/inner/claude_gateway_shim.py`](../../omnigent/inner/claude_gateway_shim.py)
and
[`tests/inner/test_claude_gateway_shim.py`](../../tests/inner/test_claude_gateway_shim.py).
Omnigent's provider normalization converts canonical Claude IDs to the
Databricks-prefixed endpoint spelling when a Databricks provider is resolved,
and keeps the canonical spelling for direct Anthropic or subscription routing;
see [`omnigent/model_override.py`](../../omnigent/model_override.py). This keeps
the example portable while still selecting the Fable 5 endpoint on Databricks.
