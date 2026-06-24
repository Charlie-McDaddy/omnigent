"""Structural test for the Debby two-headed brainstorming bundle (examples/debby).

Debby never answers from a single model: every question is fanned out to BOTH a
Claude sub-agent and a GPT sub-agent — two plain (non-coding) responders on the
claude-sdk and codex harnesses — and the ``debate`` skill has them
critique each other before converging. Pure spec-load — no LLM, no credentials —
modeled on ``test_example_polly.py``.

What breaks if this fails:
- the two heads collapse onto one vendor (no cross-model contrast — Debby's whole
  point), or a head is dropped entirely,
- a head silently switches harness (e.g. the GPT head ends up on claude-sdk),
- the ``debate`` skill is dropped or renamed (the critique loop regresses),
- the ``os_env`` block disappears (the heads lose the file/shell tools the
  brainstorming surface relies on).
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml

from omnigent.errors import OmnigentError
from omnigent.spec import load, materialize_bundle
from omnigent.spec.types import AgentSpec

# tests/e2e/omnigent/test_example_debby.py -> repo root is 3 parents up.
_DEBBY_BUNDLE = Path(__file__).resolve().parents[3] / "examples" / "debby"


@pytest.fixture(scope="module")
def debby_spec() -> AgentSpec:
    """Load and validate the debby bundle once for the module."""
    return load(_DEBBY_BUNDLE)


def test_debby_drops_unknown_harness_head_on_execution_path(tmp_path: Path) -> None:
    """A head whose harness this client can't validate is dropped, not fatal.

    The debby counterpart of matei's incident (see ``test_example_polly.py``):
    a newer server can ship debby with a head whose harness an older client
    doesn't recognize, and without graceful degradation the whole debby spec
    fails to load and *no* debby launches. This injects a deliberately-synthetic
    harness as an extra head referenced from ``tools.agents`` and asserts:

    - the strict (authoring/upload) load still fails loud — unchanged behavior;
    - the execution-path load (``prune_invalid_sub_agents=True``, used by the
      runner's spec resolution and the server's ``AgentCache``) drops ONLY the
      unsupported head and keeps debby plus its real heads.

    What breaks if this fails: an older host/runner resolving a newer debby
    hard-fails instead of launching with its supported heads — the regression in
    omnigent-ai/omnigent#1145.
    """
    real_heads = {sa.name for sa in load(_DEBBY_BUNDLE).sub_agents}
    assert real_heads, "debby should declare heads"

    bundle = materialize_bundle(_DEBBY_BUNDLE, tmp_path / "debby")
    head = bundle / "agents" / "future_head"
    head.mkdir(parents=True)
    (head / "config.yaml").write_text(
        yaml.dump(
            {
                "spec_version": 1,
                "name": "future_head",
                "executor": {
                    "type": "omnigent",
                    "config": {"harness": "harness-from-a-newer-server"},
                },
            }
        )
    )
    cfg = yaml.safe_load((bundle / "config.yaml").read_text())
    cfg.setdefault("tools", {}).setdefault("agents", []).append("future_head")
    (bundle / "config.yaml").write_text(yaml.dump(cfg))

    with pytest.raises(OmnigentError, match="invalid agent spec"):
        load(bundle)

    spec = load(bundle, prune_invalid_sub_agents=True)
    surviving = {sa.name for sa in spec.sub_agents}
    assert "future_head" not in surviving
    assert surviving == real_heads
    assert "future_head" not in spec.tools.agents


def test_debby_is_two_headed_cross_vendor(debby_spec: AgentSpec) -> None:
    """
    Debby has exactly two heads — ``claude`` on claude-sdk and ``gpt`` on
    codex — so every answer contrasts two distinct vendors.

    A missing/renamed head, or both heads landing on the same harness, removes
    the cross-model contrast that is Debby's entire reason to exist.
    """
    assert debby_spec.name == "debby"
    fam = {a.name: a.executor.config.get("harness") for a in debby_spec.sub_agents}
    # claude + gpt are the two default heads; opencode is the optional third
    # perspective (default fanout stays claude + gpt — see the prompt).
    assert sorted(debby_spec.tools.agents) == ["claude", "gpt", "opencode"]
    assert fam["claude"] == "claude-sdk"
    assert fam["gpt"] == "codex"
    assert fam["opencode"] == "opencode-native"
    # Three distinct vendors → the heads always disagree across providers.
    assert len(set(fam.values())) == 3


def test_debby_heads_are_unpinned(debby_spec: AgentSpec) -> None:
    """
    Neither head pins a model: each inherits whatever Claude / OpenAI provider
    the user configured (Anthropic key, subscription, gateway, or Databricks).

    Un-pinning is load-bearing for OSS — a Databricks-specific model id would
    404 on a plain Anthropic / OpenAI key. Re-introducing a pin re-couples a
    head to one provider, so fail here if a model reappears.
    """
    by_name = {a.name: a for a in debby_spec.sub_agents}
    for name in ("claude", "gpt"):
        assert by_name[name].executor.model is None, name
        assert by_name[name].executor.profile is None, name


def test_debby_debate_skill_present(debby_spec: AgentSpec) -> None:
    """The ``debate`` skill is discovered from skills/debate/SKILL.md."""
    assert sorted(s.name for s in debby_spec.skills) == ["debate"]


def test_debby_has_os_env(debby_spec: AgentSpec) -> None:
    """
    Debby carries an ``os_env`` block so the bridged ``sys_os_*`` tools register
    for the brainstorming surface. The shipped sandbox is ``type: none`` so the
    bundle loads on macOS too. Dropping ``os_env`` would leave the heads with no
    file/shell tools at all.
    """
    assert debby_spec.os_env is not None
    assert debby_spec.os_env.type == "caller_process"
    assert debby_spec.os_env.sandbox is not None
    assert debby_spec.os_env.sandbox.type == "none"
