"""E2E: the optimistic user-message bubble lifecycle in the chat surface.

These browser tests drive the real SPA against a spawned server and
exercise the path a queued/optimistic user message takes:

    send → optimistic bubble renders immediately → server consumes it
    (``session.input.consumed``) → bubble promotes into committed
    history (not dropped, not duplicated) → survives navigation.

They guard the store wiring this change refactored — the
``session.input.consumed`` promotion in ``chatStore.handleSessionEvent``
and the ``bindStream`` snapshot hydration of ``pendingUserMessages``. A
regression in the promote path (dropping the bubble, double-rendering
it, or popping the wrong pending entry) turns these red.

Scope caveat — read before assuming these cover everything:

The ``pending_inputs`` server-side replay this change adds is
**native-terminal only** (claude-native / codex-native): only those
sessions defer persistence to the transcript forwarder and need the
in-memory replay to survive a rebind. The e2e_ui harness runs an
``openai-agents`` agent (``conftest._TEST_AGENT_YAML``) — native claude
needs the ``claude`` CLI binary + tmux, which this harness doesn't
provide. So on this agent the user message persists at POST time and is
re-loaded from ``items`` on navigation; the native ``pending_inputs``
replay itself is covered by the unit tests
(``tests/runtime/test_pending_inputs.py`` and the ``chatStore``
``session.input.consumed`` / ``bindStream`` suites). What these e2e
tests faithfully verify is the **client** lifecycle (optimistic render,
promote-without-drop-or-dup, queue-while-streaming, navigation
hydration) end-to-end through the real SPA.

User-message bubbles are ``data-testid="message-bubble"`` +
``data-role="user"`` (see ``ChatPage.tsx``). The user's own message
text is deterministic regardless of the LLM's reply, so assertions key
off unique sentinel strings — no dependence on model output.

The last three tests cover the **docked queue** and its queue-vs-steer UX
(``data-testid="queued-message"``, the Codex model): a follow-up composed
while a turn is in flight is HELD client-side — never POSTed — and rendered
as an actionable row above the composer (``data-queued-state="held"`` with a
Steer + Delete button) rather than as a transcript bubble. Three exits:

  * **Delete** (``data-testid="queued-delete"``) drops the row with no
    server round trip — the message is never sent.
  * **Steer** (``data-testid="queued-steer"``) POSTs it into the running
    task's inbox: the row LEAVES the strip and appears inline in the
    transcript as a user bubble marked ``data-queued="true"`` (with a
    "Queued" caption underneath) until its ``session.input.consumed`` clears
    the marker and it's a normal bubble.
  * **Auto-flush** — a held message left untouched still sends when the turn
    it was waiting behind completes (the agent goes idle), so a queued
    message is never silently stranded.

Held / steered state is client send-time state, so it's observable in the
natural in-flight window without gating the LLM.
"""

from __future__ import annotations

import re

from playwright.sync_api import Page, expect

# Unique sentinels per test so a user bubble is unambiguously locatable
# and can't collide with the assistant's reply text. Worded so the model
# has no reason to echo them verbatim into its own bubble.
_NAV_MSG = "sentinel-nav-7f3a remember this exact phrase"
_PROMOTE_MSG = "sentinel-promote-91b2 keep this bubble"
_QUEUE_MSG_A = "sentinel-queue-a-4d1e first of two"
_QUEUE_MSG_B = "sentinel-queue-b-8c6f second of two"
# Docked-list test: A holds the turn open so B, composed while A streams, is
# observably held (docked above the composer) before it's steered.
_DOCK_MSG_A = "sentinel-dock-a-2f7d hold the turn open"
_DOCK_MSG_B = "sentinel-dock-b-3e9a queued behind the first"
# Auto-flush test: B is held and left untouched; it must send when A goes idle.
_AUTO_MSG_A = "sentinel-auto-a-6b2c the first turn"
_AUTO_MSG_B = "sentinel-auto-b-1e8d held and never touched"

_COMPOSER_PLACEHOLDER = "Ask the agent anything…"


def _user_bubble(page: Page, text: str):
    """Locator for the user-message bubble carrying ``text``."""
    return page.locator('[data-testid="message-bubble"][data-role="user"]').filter(has_text=text)


def _queued_row(page: Page, text: str):
    """Locator for the docked queue row carrying ``text``.

    Both held (not-yet-sent) and steered (in-flight) follow-ups render in the
    strip above the composer (``data-testid="queued-message"``), NOT inline in
    the transcript; the ``data-queued-state`` attribute distinguishes them.
    """
    return page.locator('[data-testid="queued-message"]').filter(has_text=text)


def _send(page: Page, text: str) -> None:
    """Type ``text`` into the composer and click Send.

    Clicks the button by its accessible name ``Send`` — which is present
    only when the composer has a draft (while a turn streams with no
    draft the same button is the ``Interrupt`` square), so a successful
    click also confirms the draft registered.
    """
    composer = page.get_by_label("Message the agent")
    expect(composer).to_be_visible()
    composer.fill(text)
    page.get_by_role("button", name="Send", exact=True).click()


def test_optimistic_user_bubble_renders_then_persists_through_consume(
    page: Page,
    seeded_session: tuple[str, str],
) -> None:
    """Send a message: it renders immediately and stays through the turn.

    Two claims, both about the optimistic-bubble lifecycle:

    1. The user bubble appears right after Send — before any assistant
       output — proving the optimistic render (``pendingUserMessages``)
       fires without waiting on the server.
    2. After the assistant's reply completes (so the message was
       consumed), there is still **exactly one** user bubble with that
       text. A count of 0 means the ``session.input.consumed`` promotion
       dropped the bubble; a count of 2 means it appended a committed
       block without clearing the optimistic one (double-render — the
       exact symptom this change targets).
    """
    base_url, session_id = seeded_session
    page.goto(f"{base_url}/c/{session_id}")

    _send(page, _PROMOTE_MSG)

    # (1) Optimistic render: visible well before the LLM replies.
    expect(_user_bubble(page, _PROMOTE_MSG)).to_be_visible(timeout=10_000)

    # Wait for the assistant turn to complete — a real assistant bubble
    # with non-whitespace text (not the "Working…" shimmer, which has a
    # different testid). This guarantees the consume + promote happened.
    assistant = page.locator('[data-testid="message-bubble"][data-role="assistant"]').first
    expect(assistant).to_have_text(re.compile(r"\S"), timeout=60_000)

    # (2) Exactly one user bubble survived the promote — not dropped, not
    # duplicated.
    expect(_user_bubble(page, _PROMOTE_MSG)).to_have_count(1)


def test_user_message_survives_navigation_away_and_back(
    page: Page,
    seeded_session: tuple[str, str],
) -> None:
    """Send a message, navigate away and back: the bubble re-renders.

    Mirrors the reported symptom ("navigate away and back, the message
    doesn't render until history loads"). After the turn completes we
    leave the conversation (``/`` landing) and return to ``/c/<id>``,
    forcing a cold re-hydration from the snapshot. The user bubble must
    re-render from server state — if it only existed in client-only
    optimistic state it would be gone after the round trip.

    On this (non-native) agent the message is re-loaded from ``items``;
    the native ``pending_inputs`` replay that hydrates an *un-consumed*
    message is unit-tested (see module docstring). This still guards the
    ``bindStream`` hydration path against a regression that drops
    re-rendered user bubbles.
    """
    base_url, session_id = seeded_session
    page.goto(f"{base_url}/c/{session_id}")

    _send(page, _NAV_MSG)
    expect(_user_bubble(page, _NAV_MSG)).to_be_visible(timeout=10_000)

    # Let the turn finish so the message is committed server-side before
    # we navigate (the durable state we expect to re-hydrate).
    assistant = page.locator('[data-testid="message-bubble"][data-role="assistant"]').first
    expect(assistant).to_have_text(re.compile(r"\S"), timeout=60_000)

    # Navigate away to the landing route, then back into the chat.
    page.goto(f"{base_url}/")
    expect(page.get_by_placeholder(_COMPOSER_PLACEHOLDER)).to_have_count(0)
    page.goto(f"{base_url}/c/{session_id}")

    # Re-hydrated from the snapshot — exactly one bubble, no duplicate.
    expect(_user_bubble(page, _NAV_MSG)).to_have_count(1, timeout=30_000)
    expect(_user_bubble(page, _NAV_MSG)).to_be_visible()


def test_held_message_can_be_deleted_before_sending(
    page: Page,
    seeded_session: tuple[str, str],
) -> None:
    """A follow-up composed mid-turn holds client-side; Delete drops it.

    Sends A, then types B and clicks Send while A's turn is still in flight
    (the composer keeps a working Send button whenever it holds a draft —
    ``showInterruptButton = isWorking && !hasDraft``). Because the agent is
    busy, B is HELD — it docks above the composer as an actionable row
    (``data-queued-state="held"``) and is NOT sent, so it never becomes a
    transcript bubble. Clicking its Delete (×) removes it with no server
    round trip, and it stays gone after A's turn finishes.

    This is the client-side-queue guarantee: a held message never reached
    the server, so cancel is truthful — B is never delivered to the agent.
    """
    base_url, session_id = seeded_session
    page.goto(f"{base_url}/c/{session_id}")

    _send(page, _QUEUE_MSG_A)
    expect(_user_bubble(page, _QUEUE_MSG_A)).to_be_visible(timeout=10_000)

    # Compose B while A is in flight → held (not sent), with actions.
    _send(page, _QUEUE_MSG_B)
    row = _queued_row(page, _QUEUE_MSG_B)
    expect(row).to_be_visible(timeout=10_000)
    expect(row).to_have_attribute("data-queued-state", "held")
    # Held → NOT an inline transcript bubble.
    expect(_user_bubble(page, _QUEUE_MSG_B)).to_have_count(0)

    # Delete it — client-only, no POST — and it's gone.
    row.get_by_test_id("queued-delete").click()
    expect(_queued_row(page, _QUEUE_MSG_B)).to_have_count(0)

    # Let A's turn finish. B must never appear as a transcript bubble (it was
    # never sent); A is unaffected — exactly one bubble.
    assistant = page.locator('[data-testid="message-bubble"][data-role="assistant"]').first
    expect(assistant).to_have_text(re.compile(r"\S"), timeout=60_000)
    expect(_user_bubble(page, _QUEUE_MSG_B)).to_have_count(0)
    expect(_user_bubble(page, _QUEUE_MSG_A)).to_have_count(1)


def _queued_user_bubble(page: Page, text: str):
    """Locator for an inline user bubble in the *queued* (steered) state.

    A steered send leaves the strip and renders as a normal user bubble marked
    ``data-queued="true"`` (with a "Queued" caption underneath) until it's
    picked up.
    """
    return page.locator(
        '[data-testid="message-bubble"][data-role="user"][data-queued="true"]'
    ).filter(has_text=text)


def test_held_message_steers_into_transcript_then_promotes(
    page: Page,
    seeded_session: tuple[str, str],
) -> None:
    """Held → Steer moves it into the transcript (queued), then pickup promotes it.

    The full queue-vs-steer lifecycle end-to-end:

    1. Send A → its turn goes to work. Compose B while A is in flight: B is
       held, docked as an actionable row, and NOT a transcript bubble —
       nothing is POSTed yet (a message visibly waiting, still under the
       user's control).
    2. Click **Steer** on B → it's POSTed into the running task's inbox and
       LEAVES the strip, appearing inline in the transcript as a user bubble
       marked ``data-queued="true"`` (with a "Queued" caption underneath):
       sent, awaiting pickup, no longer cancelable.
    3. On pickup B's ``session.input.consumed`` clears the ``data-queued``
       marker — it's now a normal committed bubble, exactly one, no dup.

    Steps 1–2 ride the natural in-flight window (client send-time state),
    so no LLM gating is needed; step 3 waits the turns out.
    """
    base_url, session_id = seeded_session
    page.goto(f"{base_url}/c/{session_id}")

    # Send A; as soon as its bubble is up the turn is (about to be) working.
    _send(page, _DOCK_MSG_A)
    expect(_user_bubble(page, _DOCK_MSG_A)).to_be_visible(timeout=10_000)

    # Compose B while A is in flight → held, with Steer + Delete actions.
    _send(page, _DOCK_MSG_B)
    row = _queued_row(page, _DOCK_MSG_B)
    expect(row).to_be_visible(timeout=10_000)
    expect(row).to_have_attribute("data-queued-state", "held")
    expect(row.get_by_test_id("queued-steer")).to_be_visible()
    expect(row.get_by_test_id("queued-delete")).to_be_visible()
    # Held → not yet an inline transcript bubble.
    expect(_user_bubble(page, _DOCK_MSG_B)).to_have_count(0)

    # Steer it → POSTed into A's inbox; it leaves the strip and shows up
    # inline as a queued (data-queued) bubble while it waits for pickup.
    row.get_by_test_id("queued-steer").click()
    expect(_queued_row(page, _DOCK_MSG_B)).to_have_count(0, timeout=10_000)
    expect(_queued_user_bubble(page, _DOCK_MSG_B)).to_be_visible(timeout=10_000)

    # Drain both turns. Once B is picked up the queued marker clears — it's a
    # normal committed bubble, exactly one each, no drop/dup.
    assistant = page.locator('[data-testid="message-bubble"][data-role="assistant"]').first
    expect(assistant).to_have_text(re.compile(r"\S"), timeout=60_000)
    expect(_queued_user_bubble(page, _DOCK_MSG_B)).to_have_count(0, timeout=60_000)
    expect(_user_bubble(page, _DOCK_MSG_A)).to_have_count(1, timeout=60_000)
    expect(_user_bubble(page, _DOCK_MSG_B)).to_have_count(1, timeout=60_000)


def test_held_message_auto_sends_when_agent_goes_idle(
    page: Page,
    seeded_session: tuple[str, str],
) -> None:
    """A held follow-up left untouched still sends when the agent frees up.

    The bug guard: send A → working. Compose B (held) and leave it — never
    Steer, never Delete. When A's turn completes and the session goes idle,
    the held queue auto-flushes: B leaves the strip and lands in the
    transcript as a real bubble. A queued message must never be stranded.
    """
    base_url, session_id = seeded_session
    page.goto(f"{base_url}/c/{session_id}")

    _send(page, _AUTO_MSG_A)
    expect(_user_bubble(page, _AUTO_MSG_A)).to_be_visible(timeout=10_000)

    # Compose B while A is in flight → held, and NOT a transcript bubble.
    _send(page, _AUTO_MSG_B)
    expect(_queued_row(page, _AUTO_MSG_B)).to_have_attribute(
        "data-queued-state", "held", timeout=10_000
    )
    expect(_user_bubble(page, _AUTO_MSG_B)).to_have_count(0)

    # Leave it alone. When A's turn ends (idle), the held queue auto-flushes:
    # B leaves the strip and is sent — it renders as exactly one transcript
    # bubble without any user action.
    expect(_queued_row(page, _AUTO_MSG_B)).to_have_count(0, timeout=60_000)
    expect(_user_bubble(page, _AUTO_MSG_B)).to_have_count(1, timeout=60_000)
