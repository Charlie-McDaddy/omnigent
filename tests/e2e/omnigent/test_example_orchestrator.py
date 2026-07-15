"""Structural test for the tool-free Orchestrator example.

The bundle is planning-and-review only. These checks load the production spec
without starting an LLM and lock down the capability omissions that make the
agent text-only.
"""

from __future__ import annotations

import importlib
from pathlib import Path

import pytest

from omnigent.spec import load
from omnigent.spec.types import AgentSpec

# tests/e2e/omnigent/test_example_orchestrator.py -> repo root is 3 parents up.
_ORCHESTRATOR_BUNDLE = Path(__file__).resolve().parents[3] / "examples" / "orchestrator"


@pytest.fixture(scope="module")
def orchestrator_spec() -> AgentSpec:
    """Load and validate the Orchestrator bundle once for the module."""
    return load(_ORCHESTRATOR_BUNDLE, expand_env=False)


def test_orchestrator_model_and_harness(orchestrator_spec: AgentSpec) -> None:
    """Orchestrator pins canonical Claude Fable 5 on the Claude SDK."""
    assert orchestrator_spec.name == "orchestrator"
    assert orchestrator_spec.executor.model == "claude-fable-5"
    assert orchestrator_spec.executor.config.get("harness") == "claude-sdk"


def test_orchestrator_has_no_research_or_execution_capabilities(
    orchestrator_spec: AgentSpec,
) -> None:
    """No declared capability can read, search, edit, execute, or delegate."""
    assert orchestrator_spec.skills_filter == "none"
    assert orchestrator_spec.tools.builtins == []
    assert orchestrator_spec.tools.agents == []
    assert orchestrator_spec.local_tools == []
    assert orchestrator_spec.mcp_servers == []
    assert orchestrator_spec.sub_agents == []
    assert orchestrator_spec.os_env is None
    assert orchestrator_spec.terminals is None
    assert orchestrator_spec.async_enabled is False
    assert orchestrator_spec.spawn is False
    assert orchestrator_spec.timers is False


def test_orchestrator_is_text_only(orchestrator_spec: AgentSpec) -> None:
    """The interaction contract accepts and produces only text."""
    assert orchestrator_spec.interaction.modalities.input == ["text"]
    assert orchestrator_spec.interaction.modalities.output == ["text"]


def test_orchestrator_denies_every_tool_call(orchestrator_spec: AgentSpec) -> None:
    """The zero-call guardrail blocks platform-provided session-read tools."""
    policies = orchestrator_spec.guardrails.policies
    assert [policy.name for policy in policies] == ["deny_all_tools"]
    policy = policies[0]
    assert policy.function.arguments == {"limit": 0}
    module, _, name = policy.function.path.rpartition(".")
    factory = getattr(importlib.import_module(module), name)
    response = factory(**policy.function.arguments)({"type": "tool_call"})
    assert response["result"] == "DENY"


def test_orchestrator_prompt_declares_only_plan_and_review(orchestrator_spec: AgentSpec) -> None:
    """The behavioral boundary covers both allowed modes and evidence limits."""
    prompt = " ".join(orchestrator_spec.instructions.split()).lower()
    for token in ("plan", "review", "must never research", "never claim or imply"):
        assert token in prompt
