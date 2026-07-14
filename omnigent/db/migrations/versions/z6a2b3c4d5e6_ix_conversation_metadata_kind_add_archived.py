"""Add archived to ix_conversation_metadata_kind index.

Revision ID: z6a2b3c4d5e6
Revises: bb2c3d4e5f6a
Create Date: 2026-07-14 00:00:00.000000

``list_conversations`` pre-filters ``omnigent_conversation_metadata`` with
``kind = ?`` and (when ``include_archived=False``, the common case)
``archived = false``.  The existing index
``ix_conversation_metadata_kind`` covers ``(workspace_id, kind, id)`` but
omits ``archived``, so the planner heap-fetches every kind-matching row to
evaluate the archived predicate.

Rebuilding the index as ``(workspace_id, kind, archived, id)`` lets the
planner satisfy both predicates from the index alone, eliminating the
heap fetches. This benefits every endpoint that calls
``list_conversations`` with a ``kind`` filter:

  - GET /v1/sessions/{id}/stream      (child-session snapshot on connect)
  - GET /v1/sessions/{id}/child_sessions
  - GET /v1/sessions                  (list with kind/archived filters)
"""

from __future__ import annotations

from collections.abc import Sequence

from alembic import op

revision: str = "z6a2b3c4d5e6"
down_revision: str | None = "bb2c3d4e5f6a"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    """Rebuild ix_conversation_metadata_kind to include archived."""
    op.drop_index("ix_conversation_metadata_kind", table_name="omnigent_conversation_metadata")
    op.create_index(
        "ix_conversation_metadata_kind",
        "omnigent_conversation_metadata",
        ["workspace_id", "kind", "archived", "id"],
    )


def downgrade() -> None:
    """Restore ix_conversation_metadata_kind without archived."""
    op.drop_index("ix_conversation_metadata_kind", table_name="omnigent_conversation_metadata")
    op.create_index(
        "ix_conversation_metadata_kind",
        "omnigent_conversation_metadata",
        ["workspace_id", "kind", "id"],
    )
