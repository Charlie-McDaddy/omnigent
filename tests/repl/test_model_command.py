"""Tests for the TUI ``/model`` slash command and its no-arg picker."""

from __future__ import annotations

import pytest
from omnigent_ui_sdk.terminal import RichBlockFormatter, TerminalHost

from omnigent.model_catalog import picker_models_by_family
from omnigent.repl._repl import (
    COMMANDS,
    _model_picker_entries,
    _resolve_model_picker_index,
    handle_slash_command,
)


class DummyHost(TerminalHost):
    def __init__(self) -> None:
        super().__init__(model_name="test")
        self.outputs: list[object] = []

    def output(self, renderable, *, soft_wrap: bool = False) -> None:  # type: ignore[override]
        self.outputs.append(renderable)


class DummySession:
    def __init__(self) -> None:
        self.model_override: str | None = None
        self.is_streaming = False

    def set_model_override(self, value: str | None) -> None:
        self.model_override = value


def _text(host: DummyHost) -> str:
    return "\n".join(str(item) for item in host.outputs)


def test_model_command_registered() -> None:
    assert "/model" in COMMANDS
    assert "model" in COMMANDS["/model"][0].lower()


def test_picker_entries_cover_claude_gpt_and_gemini_families() -> None:
    """The picker draws from the curated catalog, not an ad hoc REPL list."""
    entries = _model_picker_entries()
    families = {family for family, _ in entries}
    assert families == {"claude", "gpt", "gemini"}

    by_family = picker_models_by_family()
    assert entries == [
        (family, model_id)
        for family in ("claude", "gpt", "gemini")
        for model_id in by_family[family]
    ]


def test_resolve_model_picker_index_round_trips_with_entries() -> None:
    entries = _model_picker_entries()
    assert _resolve_model_picker_index(1) == entries[0][1]
    assert _resolve_model_picker_index(len(entries)) == entries[-1][1]


def test_resolve_model_picker_index_out_of_range_returns_none() -> None:
    assert _resolve_model_picker_index(0) is None
    assert _resolve_model_picker_index(len(_model_picker_entries()) + 1) is None


@pytest.mark.asyncio
async def test_model_no_args_shows_picker_with_multiple_families(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``/model`` with no argument renders a picker table, not just the readout."""
    monkeypatch.setenv("OMNIGENT_CONFIG_HOME", str(tmp_path))
    host = DummyHost()
    fmt = RichBlockFormatter()
    session = DummySession()

    await handle_slash_command("/model", session, None, host, fmt)  # type: ignore[arg-type]

    from rich.console import Console
    from rich.table import Table

    tables = [item for item in host.outputs if isinstance(item, Table)]
    assert len(tables) == 1, "expected exactly one picker table in the output"
    console = Console(width=100, record=True)
    console.print(tables[0])
    rendered_table = console.export_text()
    assert "Pick a model" in rendered_table
    for family in ("claude", "gpt", "gemini"):
        assert family in rendered_table

    rendered = _text(host)
    assert "/model <#>" in rendered


@pytest.mark.asyncio
async def test_model_explicit_id_still_sets_override_directly(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``/model <id>`` keeps working exactly as before — no regression."""
    monkeypatch.setenv("OMNIGENT_CONFIG_HOME", str(tmp_path))
    host = DummyHost()
    fmt = RichBlockFormatter()
    session = DummySession()

    await handle_slash_command("/model claude-opus-4-8", session, None, host, fmt)  # type: ignore[arg-type]

    assert session.model_override == "claude-opus-4-8"
    assert "model set to claude-opus-4-8" in _text(host)


@pytest.mark.asyncio
async def test_model_picker_selection_by_number_switches_model(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Picking a picker row (``/model <#>``) behaves like ``/model <id>``."""
    monkeypatch.setenv("OMNIGENT_CONFIG_HOME", str(tmp_path))
    host = DummyHost()
    fmt = RichBlockFormatter()
    session = DummySession()

    entries = _model_picker_entries()
    gemini_index = next(i for i, (family, _) in enumerate(entries, 1) if family == "gemini")
    expected_id = entries[gemini_index - 1][1]

    await handle_slash_command(f"/model {gemini_index}", session, None, host, fmt)  # type: ignore[arg-type]

    assert session.model_override == expected_id
    assert f"model set to {expected_id}" in _text(host)


@pytest.mark.asyncio
async def test_model_picker_selection_out_of_range_errors(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.setenv("OMNIGENT_CONFIG_HOME", str(tmp_path))
    host = DummyHost()
    fmt = RichBlockFormatter()
    session = DummySession()

    out_of_range = len(_model_picker_entries()) + 1
    await handle_slash_command(f"/model {out_of_range}", session, None, host, fmt)  # type: ignore[arg-type]

    assert session.model_override is None
    assert f"No model #{out_of_range}" in _text(host)


@pytest.mark.asyncio
async def test_model_clear_alias_still_resets_override(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """``/model default`` (a non-digit alias) is unaffected by digit resolution."""
    monkeypatch.setenv("OMNIGENT_CONFIG_HOME", str(tmp_path))
    host = DummyHost()
    fmt = RichBlockFormatter()
    session = DummySession()
    session.model_override = "claude-opus-4-8"

    await handle_slash_command("/model default", session, None, host, fmt)  # type: ignore[arg-type]

    assert session.model_override is None
    assert "model reset to agent default" in _text(host)


@pytest.mark.asyncio
async def test_model_bare_digit_is_always_a_picker_index_never_a_literal_id(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A bare all-digit argument is ALWAYS the picker index, by design.

    Locks in the documented tradeoff in ``_cmd_model``'s docstring: every
    curated model id contains letters, so an in-range digit string is
    never ambiguous with a real catalog id — it always resolves through
    the picker, never sets the digit string itself as a literal override.
    A regression here (treating the digits as a literal id when no picker
    row happens to collide) would silently select the wrong model instead
    of the one implied by the picker table.
    """
    monkeypatch.setenv("OMNIGENT_CONFIG_HOME", str(tmp_path))
    host = DummyHost()
    fmt = RichBlockFormatter()
    session = DummySession()

    entries = _model_picker_entries()
    await handle_slash_command("/model 1", session, None, host, fmt)  # type: ignore[arg-type]

    assert session.model_override == entries[0][1]
    assert session.model_override != "1"


@pytest.mark.asyncio
async def test_model_numeric_gateway_id_escapes_picker_via_provider_prefix(
    tmp_path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A genuinely numeric model id can still be set via ``<provider>/<id>``.

    The documented escape hatch for an all-digit gateway model id: qualify
    it with a provider prefix so the string contains ``/`` and never
    matches the bare-digit picker-index branch.
    """
    monkeypatch.setenv("OMNIGENT_CONFIG_HOME", str(tmp_path))
    host = DummyHost()
    fmt = RichBlockFormatter()
    session = DummySession()

    await handle_slash_command("/model openrouter/123", session, None, host, fmt)  # type: ignore[arg-type]

    assert session.model_override == "openrouter/123"
