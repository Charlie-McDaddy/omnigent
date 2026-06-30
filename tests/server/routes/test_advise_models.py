"""Unit tests for the server-side ``POST /v1/sessions/{id}/advise-models`` endpoint.

Tests the core logic of the ``advise_models`` route handler by exercising
the ``create_sessions_router`` factory with minimal stubs and a mock
``routing_client`` on ``RuntimeCaps``.

Covers:
- ``routing_client=None`` → ``{"router_on": False, "recommendations": []}``
- routing_client present → returns model/tier/rationale per task
- Unknown agent falls back to heuristic harness mapping
- Multiple tasks are all processed independently
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from omnigent.server.smart_routing import RoutingResult

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_routing_client(result: RoutingResult | None) -> Any:  # type: ignore[explicit-any]
    """Return a mock routing client whose ``route`` returns *result*."""
    client = MagicMock()
    client.route = AsyncMock(return_value=result)
    return client


def _make_caps(routing_client: Any | None) -> Any:  # type: ignore[explicit-any]
    """Return a minimal mock RuntimeCaps."""
    caps = MagicMock()
    caps.routing_client = routing_client
    return caps


def _make_conv(agent_id: str | None = "agent_test") -> Any:  # type: ignore[explicit-any]
    conv = MagicMock()
    conv.id = "conv_test"
    conv.agent_id = agent_id
    return conv


def _make_access(conv: Any) -> Any:  # type: ignore[explicit-any]
    access = MagicMock()
    access.conversation = conv
    return access


# ---------------------------------------------------------------------------
# Inline handler tests (direct call via module-level helper)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_advise_models_router_off(monkeypatch: pytest.MonkeyPatch) -> None:
    """When routing_client is None, returns router_on=False with empty recommendations."""
    from omnigent.server.routes.sessions import create_sessions_router

    caps = _make_caps(None)
    conv = _make_conv()
    access = _make_access(conv)

    conv_store = MagicMock()
    conv_store.get_conversation = MagicMock(return_value=conv)
    agent_store = MagicMock()

    router_factory_kwargs: dict[str, Any] = {
        "conversation_store": conv_store,
        "agent_store": agent_store,
    }

    with (
        patch("omnigent.server.routes.sessions.get_caps", return_value=caps),
        patch(
            "omnigent.server.routes.sessions._require_user",
            return_value="user_test",
        ),
        patch(
            "omnigent.server.routes.sessions._require_access_and_level",
            AsyncMock(return_value=access),
        ),
    ):
        # Build the router — we don't actually call via HTTP; we find and
        # invoke the route function directly.
        router = create_sessions_router(**router_factory_kwargs)

    # Find the advise_models route handler in the router's routes.
    advise_fn = None
    for route in router.routes:
        if hasattr(route, "path") and "advise-models" in route.path:
            advise_fn = route.endpoint
            break
    assert advise_fn is not None, "advise_models route not registered"

    request = MagicMock()
    body = MagicMock()
    body.tasks = []

    with (
        patch("omnigent.server.routes.sessions.get_caps", return_value=caps),
        patch(
            "omnigent.server.routes.sessions._require_user",
            return_value="user_test",
        ),
        patch(
            "omnigent.server.routes.sessions._require_access_and_level",
            AsyncMock(return_value=access),
        ),
    ):
        result = await advise_fn(request=request, session_id="conv_test", body=body)

    assert result == {"router_on": False, "recommendations": []}


@pytest.mark.asyncio
async def test_advise_models_with_routing_client(monkeypatch: pytest.MonkeyPatch) -> None:
    """With a routing_client, each task gets a model/tier/rationale recommendation."""
    from omnigent.server.routes.sessions import create_sessions_router

    verdict = RoutingResult(
        model="databricks-claude-opus-4-8",
        tier="expensive",
        rationale="Complex refactor.",
    )
    routing_client = _make_routing_client(verdict)
    caps = _make_caps(routing_client)
    conv = _make_conv(agent_id=None)
    access = _make_access(conv)

    conv_store = MagicMock()
    agent_store = MagicMock()

    router = create_sessions_router(
        conversation_store=conv_store,
        agent_store=agent_store,
    )

    advise_fn = None
    for route in router.routes:
        if hasattr(route, "path") and "advise-models" in route.path:
            advise_fn = route.endpoint
            break
    assert advise_fn is not None

    task_obj = MagicMock()
    task_obj.title = "auth-refactor"
    task_obj.agent = "claude_code"
    task_obj.task = "Refactor the auth flow"

    body = MagicMock()
    body.tasks = [task_obj]
    request = MagicMock()

    with (
        patch("omnigent.server.routes.sessions.get_caps", return_value=caps),
        patch(
            "omnigent.server.routes.sessions._require_user",
            return_value="user_test",
        ),
        patch(
            "omnigent.server.routes.sessions._require_access_and_level",
            AsyncMock(return_value=access),
        ),
    ):
        result = await advise_fn(request=request, session_id="conv_test", body=body)

    assert result["router_on"] is True
    assert len(result["recommendations"]) == 1
    rec = result["recommendations"][0]
    assert rec["title"] == "auth-refactor"
    assert rec["agent"] == "claude_code"
    assert rec["model"] == "databricks-claude-opus-4-8"
    assert rec["tier"] == "expensive"
    assert rec["rationale"] == "Complex refactor."
    routing_client.route.assert_called_once()


@pytest.mark.asyncio
async def test_advise_models_unknown_agent_graceful(monkeypatch: pytest.MonkeyPatch) -> None:
    """An unknown agent with no harness match gets null model/tier and an informative rationale."""
    from omnigent.server.routes.sessions import create_sessions_router

    routing_client = _make_routing_client(RoutingResult(model="m", tier="cheap", rationale="r"))
    caps = _make_caps(routing_client)
    conv = _make_conv(agent_id=None)
    access = _make_access(conv)

    router = create_sessions_router(
        conversation_store=MagicMock(),
        agent_store=MagicMock(),
    )

    advise_fn = None
    for route in router.routes:
        if hasattr(route, "path") and "advise-models" in route.path:
            advise_fn = route.endpoint
            break
    assert advise_fn is not None

    task_obj = MagicMock()
    task_obj.title = "mystery"
    task_obj.agent = "completely_unknown_worker"
    task_obj.task = "Do something"

    body = MagicMock()
    body.tasks = [task_obj]
    request = MagicMock()

    with (
        patch("omnigent.server.routes.sessions.get_caps", return_value=caps),
        patch(
            "omnigent.server.routes.sessions._require_user",
            return_value="user_test",
        ),
        patch(
            "omnigent.server.routes.sessions._require_access_and_level",
            AsyncMock(return_value=access),
        ),
    ):
        result = await advise_fn(request=request, session_id="conv_test", body=body)

    assert result["router_on"] is True
    recs = result["recommendations"]
    assert len(recs) == 1
    rec = recs[0]
    assert rec["model"] is None
    assert rec["tier"] is None
    assert "no tiers available" in rec["rationale"]
    # route() should NOT be called since there are no tiers to pass
    routing_client.route.assert_not_called()
