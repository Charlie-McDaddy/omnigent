"""Unit tests for :mod:`omnigent.claude_launcher`."""

from __future__ import annotations

import importlib.metadata

import pytest

from omnigent.claude_launcher import (
    CLAUDE_LAUNCHER_ENTRY_POINT_GROUP,
    CLAUDE_LAUNCHER_ENV_VAR,
    resolve_claude_launch,
)


class _FakeEntryPoint:
    """Minimal stand-in for :class:`importlib.metadata.EntryPoint`."""

    def __init__(self, name, value):
        self.name = name
        self._value = value

    def load(self):
        if isinstance(self._value, BaseException):
            raise self._value
        return self._value


def _register(monkeypatch, *entry_points, raise_on_enumerate=None):
    """Make ``importlib.metadata.entry_points(group=...)`` return *entry_points*."""

    def fake_entry_points(*, group):
        assert group == CLAUDE_LAUNCHER_ENTRY_POINT_GROUP
        if raise_on_enumerate is not None:
            raise raise_on_enumerate
        return list(entry_points)

    monkeypatch.setattr(importlib.metadata, "entry_points", fake_entry_points)


def test_identity_when_env_unset(monkeypatch):
    monkeypatch.delenv(CLAUDE_LAUNCHER_ENV_VAR, raising=False)
    assert resolve_claude_launch("claude", ["--foo", "bar"]) == ("claude", ["--foo", "bar"])


def test_identity_returns_fresh_list(monkeypatch):
    monkeypatch.delenv(CLAUDE_LAUNCHER_ENV_VAR, raising=False)
    original = ["--foo"]
    _, args = resolve_claude_launch("claude", original)
    assert args == original
    assert args is not original


def test_plugin_wraps_command(monkeypatch):
    def wrap(command, args):
        return "isaac", ["claude", "--omni-internal", "--", *args]

    _register(monkeypatch, _FakeEntryPoint("isaac", wrap))
    monkeypatch.setenv(CLAUDE_LAUNCHER_ENV_VAR, "isaac")
    command, args = resolve_claude_launch("claude", ["--mcp-config", "{}"])
    assert command == "isaac"
    assert args == ["claude", "--omni-internal", "--", "--mcp-config", "{}"]


def test_plugin_selected_by_name_among_several(monkeypatch):
    _register(
        monkeypatch,
        _FakeEntryPoint("other", lambda command, args: ("nope", [])),
        _FakeEntryPoint("isaac", lambda command, args: ("isaac", ["--", *args])),
    )
    monkeypatch.setenv(CLAUDE_LAUNCHER_ENV_VAR, "isaac")
    command, args = resolve_claude_launch("claude", ["--x"])
    assert command == "isaac"
    assert args == ["--", "--x"]


def test_plugin_receives_default_command_and_args(monkeypatch):
    seen = {}

    def wrap(command, args):
        seen["command"], seen["args"] = command, args
        return command, args

    _register(monkeypatch, _FakeEntryPoint("isaac", wrap))
    monkeypatch.setenv(CLAUDE_LAUNCHER_ENV_VAR, "isaac")
    resolve_claude_launch("claude", ["--x"])
    assert seen == {"command": "claude", "args": ["--x"]}


def test_unknown_name_falls_back(monkeypatch):
    _register(monkeypatch, _FakeEntryPoint("isaac", lambda command, args: ("isaac", [])))
    monkeypatch.setenv(CLAUDE_LAUNCHER_ENV_VAR, "nonexistent")
    assert resolve_claude_launch("claude", ["--x"]) == ("claude", ["--x"])


def test_enumerate_error_falls_back(monkeypatch):
    _register(monkeypatch, raise_on_enumerate=RuntimeError("boom"))
    monkeypatch.setenv(CLAUDE_LAUNCHER_ENV_VAR, "isaac")
    assert resolve_claude_launch("claude", ["--x"]) == ("claude", ["--x"])


def test_load_error_falls_back(monkeypatch):
    _register(monkeypatch, _FakeEntryPoint("isaac", ImportError("missing dep")))
    monkeypatch.setenv(CLAUDE_LAUNCHER_ENV_VAR, "isaac")
    assert resolve_claude_launch("claude", ["--x"]) == ("claude", ["--x"])


def test_not_callable_falls_back(monkeypatch):
    _register(monkeypatch, _FakeEntryPoint("isaac", "not-callable"))
    monkeypatch.setenv(CLAUDE_LAUNCHER_ENV_VAR, "isaac")
    assert resolve_claude_launch("claude", ["--x"]) == ("claude", ["--x"])


def test_plugin_raises_falls_back(monkeypatch):
    def boom(command, args):
        raise RuntimeError("boom")

    _register(monkeypatch, _FakeEntryPoint("isaac", boom))
    monkeypatch.setenv(CLAUDE_LAUNCHER_ENV_VAR, "isaac")
    assert resolve_claude_launch("claude", ["--x"]) == ("claude", ["--x"])


@pytest.mark.parametrize(
    "bad",
    [
        "notatuple",
        ("only-one",),
        ("", ["x"]),
        ("cmd", "notalist"),
        ("cmd", [1, 2]),
        (123, ["x"]),
    ],
)
def test_malformed_return_falls_back(monkeypatch, bad):
    _register(monkeypatch, _FakeEntryPoint("isaac", lambda command, args: bad))
    monkeypatch.setenv(CLAUDE_LAUNCHER_ENV_VAR, "isaac")
    assert resolve_claude_launch("claude", ["--x"]) == ("claude", ["--x"])
