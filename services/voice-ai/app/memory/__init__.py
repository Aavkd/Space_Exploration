"""Memory package - SQLite-backed conversation history, preferences and manual facts."""

from __future__ import annotations

import json
import sqlite3
import uuid
from pathlib import Path
from typing import TYPE_CHECKING, Any

from app.providers.embeddings import EmbeddingProviderError, cosine_similarity

if TYPE_CHECKING:
    from app.providers.embeddings import EmbeddingsGateway


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _now_iso() -> str:
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _new_id() -> str:
    return str(uuid.uuid4())


# ---------------------------------------------------------------------------
# Schema
# ---------------------------------------------------------------------------

_SCHEMA_SQL = """
CREATE TABLE IF NOT EXISTS conversations (
    id             TEXT PRIMARY KEY,
    persona_id     TEXT NOT NULL DEFAULT '',
    session_id     TEXT NOT NULL DEFAULT '',
    retention_mode TEXT NOT NULL DEFAULT 'transcript_and_summary',
    started_at     TEXT NOT NULL,
    ended_at       TEXT,
    message_count  INTEGER NOT NULL DEFAULT 0,
    metadata       TEXT NOT NULL DEFAULT '{}'
);

CREATE TABLE IF NOT EXISTS messages (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    role            TEXT NOT NULL,
    content         TEXT NOT NULL,
    timestamp       TEXT NOT NULL,
    provider_id     TEXT NOT NULL DEFAULT '',
    model           TEXT NOT NULL DEFAULT '',
    latency_ms      INTEGER,
    metadata        TEXT NOT NULL DEFAULT '{}'
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);

CREATE TABLE IF NOT EXISTS summaries (
    id              TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    content         TEXT NOT NULL,
    created_at      TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_summaries_conversation ON summaries(conversation_id);

CREATE TABLE IF NOT EXISTS preferences (
    key        TEXT NOT NULL,
    persona_id TEXT NOT NULL DEFAULT '',
    value      TEXT NOT NULL DEFAULT 'null',
    updated_at TEXT NOT NULL,
    PRIMARY KEY (key, persona_id)
);

CREATE TABLE IF NOT EXISTS memories (
    id         TEXT PRIMARY KEY,
    persona_id TEXT NOT NULL DEFAULT '',
    content    TEXT NOT NULL,
    source     TEXT NOT NULL DEFAULT 'manual',
    tags       TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memories_persona ON memories(persona_id);

CREATE TABLE IF NOT EXISTS memory_embeddings (
    memory_id     TEXT PRIMARY KEY REFERENCES memories(id) ON DELETE CASCADE,
    provider_id   TEXT NOT NULL,
    provider_kind TEXT NOT NULL,
    model         TEXT NOT NULL DEFAULT '',
    dimensions    INTEGER NOT NULL,
    vector        TEXT NOT NULL,
    indexed_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_memory_embeddings_provider
ON memory_embeddings(provider_id, model);
"""


# ---------------------------------------------------------------------------
# MemoryStore
# ---------------------------------------------------------------------------


class MemoryStore:
    """Low-level SQLite wrapper. Thread-safe via check_same_thread=False and WAL mode."""

    def __init__(self, db_path: Path) -> None:
        db_path.parent.mkdir(parents=True, exist_ok=True)
        self._path = db_path
        self._conn = sqlite3.connect(str(db_path), check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")
        self._conn.execute("PRAGMA foreign_keys=ON")
        self._conn.executescript(_SCHEMA_SQL)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    @property
    def db_path(self) -> Path:
        return self._path

    # --- Conversations ---

    def insert_conversation(
        self,
        *,
        persona_id: str = "",
        session_id: str = "",
        retention_mode: str = "transcript_and_summary",
        metadata: dict[str, Any] | None = None,
    ) -> str:
        row_id = _new_id()
        self._conn.execute(
            "INSERT INTO conversations (id, persona_id, session_id, retention_mode, started_at, metadata)"
            " VALUES (?, ?, ?, ?, ?, ?)",
            (row_id, persona_id, session_id, retention_mode, _now_iso(), json.dumps(metadata or {})),
        )
        self._conn.commit()
        return row_id

    def close_conversation(self, conversation_id: str) -> None:
        self._conn.execute(
            "UPDATE conversations SET ended_at = ? WHERE id = ?",
            (_now_iso(), conversation_id),
        )
        self._conn.commit()

    def _increment_message_count(self, conversation_id: str) -> None:
        self._conn.execute(
            "UPDATE conversations SET message_count = message_count + 1 WHERE id = ?",
            (conversation_id,),
        )
        self._conn.commit()

    def list_conversations(
        self,
        *,
        persona_id: str | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        if persona_id is not None:
            rows = self._conn.execute(
                "SELECT * FROM conversations WHERE persona_id = ? ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (persona_id, limit, offset),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM conversations ORDER BY started_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["metadata"] = json.loads(item["metadata"])
            result.append(item)
        return result

    def get_conversation(self, conversation_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM conversations WHERE id = ?", (conversation_id,)
        ).fetchone()
        if row is None:
            return None
        item = dict(row)
        item["metadata"] = json.loads(item["metadata"])
        return item

    def delete_conversation(self, conversation_id: str) -> bool:
        cursor = self._conn.execute(
            "DELETE FROM conversations WHERE id = ?", (conversation_id,)
        )
        self._conn.commit()
        return cursor.rowcount > 0

    def count_conversations(self, *, persona_id: str | None = None) -> int:
        if persona_id is not None:
            row = self._conn.execute(
                "SELECT COUNT(*) FROM conversations WHERE persona_id = ?", (persona_id,)
            ).fetchone()
        else:
            row = self._conn.execute("SELECT COUNT(*) FROM conversations").fetchone()
        return row[0] if row else 0

    # --- Messages ---

    def insert_message(
        self,
        *,
        conversation_id: str,
        role: str,
        content: str,
        provider_id: str = "",
        model: str = "",
        latency_ms: int | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> str:
        row_id = _new_id()
        self._conn.execute(
            "INSERT INTO messages (id, conversation_id, role, content, timestamp,"
            " provider_id, model, latency_ms, metadata)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (
                row_id,
                conversation_id,
                role,
                content,
                _now_iso(),
                provider_id,
                model,
                latency_ms,
                json.dumps(metadata or {}),
            ),
        )
        self._conn.commit()
        self._increment_message_count(conversation_id)
        return row_id

    def list_messages(self, conversation_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM messages WHERE conversation_id = ? ORDER BY timestamp ASC",
            (conversation_id,),
        ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["metadata"] = json.loads(item["metadata"])
            result.append(item)
        return result

    def count_messages(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) FROM messages").fetchone()
        return row[0] if row else 0

    # --- Summaries ---

    def insert_summary(self, *, conversation_id: str, content: str) -> str:
        row_id = _new_id()
        self._conn.execute(
            "INSERT INTO summaries (id, conversation_id, content, created_at) VALUES (?, ?, ?, ?)",
            (row_id, conversation_id, content, _now_iso()),
        )
        self._conn.commit()
        return row_id

    def list_summaries(self, conversation_id: str) -> list[dict[str, Any]]:
        rows = self._conn.execute(
            "SELECT * FROM summaries WHERE conversation_id = ? ORDER BY created_at ASC",
            (conversation_id,),
        ).fetchall()
        return [dict(row) for row in rows]

    # --- Preferences ---

    def set_preference(self, key: str, value: Any, *, persona_id: str = "") -> None:
        self._conn.execute(
            "INSERT INTO preferences (key, persona_id, value, updated_at) VALUES (?, ?, ?, ?)"
            " ON CONFLICT(key, persona_id) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
            (key, persona_id, json.dumps(value), _now_iso()),
        )
        self._conn.commit()

    def get_preference(self, key: str, *, persona_id: str = "") -> Any:
        row = self._conn.execute(
            "SELECT value FROM preferences WHERE key = ? AND persona_id = ?",
            (key, persona_id),
        ).fetchone()
        if row is None:
            return None
        return json.loads(row["value"])

    def delete_preference(self, key: str, *, persona_id: str = "") -> bool:
        cursor = self._conn.execute(
            "DELETE FROM preferences WHERE key = ? AND persona_id = ?",
            (key, persona_id),
        )
        self._conn.commit()
        return cursor.rowcount > 0

    def list_preferences(self, *, persona_id: str | None = None) -> list[dict[str, Any]]:
        if persona_id is not None:
            rows = self._conn.execute(
                "SELECT * FROM preferences WHERE persona_id = ? ORDER BY key ASC",
                (persona_id,),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM preferences ORDER BY key ASC"
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["value"] = json.loads(item["value"])
            result.append(item)
        return result

    def count_preferences(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) FROM preferences").fetchone()
        return row[0] if row else 0

    # --- Memory entries (manual facts) ---

    def insert_memory(
        self,
        *,
        content: str,
        persona_id: str = "",
        source: str = "manual",
        tags: list[str] | None = None,
    ) -> str:
        row_id = _new_id()
        now = _now_iso()
        self._conn.execute(
            "INSERT INTO memories (id, persona_id, content, source, tags, created_at, updated_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)",
            (row_id, persona_id, content, source, json.dumps(tags or []), now, now),
        )
        self._conn.commit()
        return row_id

    def get_memory(self, memory_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM memories WHERE id = ?", (memory_id,)
        ).fetchone()
        if row is None:
            return None
        item = dict(row)
        item["tags"] = json.loads(item["tags"])
        return item

    def update_memory(
        self,
        memory_id: str,
        *,
        content: str | None = None,
        tags: list[str] | None = None,
    ) -> bool:
        existing = self.get_memory(memory_id)
        if existing is None:
            return False
        new_content = content if content is not None else existing["content"]
        new_tags = tags if tags is not None else existing["tags"]
        self._conn.execute(
            "UPDATE memories SET content = ?, tags = ?, updated_at = ? WHERE id = ?",
            (new_content, json.dumps(new_tags), _now_iso(), memory_id),
        )
        self._conn.commit()
        return True

    def delete_memory(self, memory_id: str) -> bool:
        cursor = self._conn.execute(
            "DELETE FROM memories WHERE id = ?", (memory_id,)
        )
        self._conn.commit()
        return cursor.rowcount > 0

    def list_memories(
        self,
        *,
        persona_id: str | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        if persona_id is not None:
            rows = self._conn.execute(
                "SELECT * FROM memories WHERE persona_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (persona_id, limit, offset),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM memories ORDER BY created_at DESC LIMIT ? OFFSET ?",
                (limit, offset),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["tags"] = json.loads(item["tags"])
            result.append(item)
        return result

    def count_memories(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) FROM memories").fetchone()
        return row[0] if row else 0

    # --- Memory embeddings ---

    def upsert_memory_embedding(
        self,
        *,
        memory_id: str,
        provider_id: str,
        provider_kind: str,
        model: str,
        vector: list[float],
    ) -> None:
        self._conn.execute(
            "INSERT INTO memory_embeddings"
            " (memory_id, provider_id, provider_kind, model, dimensions, vector, indexed_at)"
            " VALUES (?, ?, ?, ?, ?, ?, ?)"
            " ON CONFLICT(memory_id) DO UPDATE SET"
            " provider_id=excluded.provider_id,"
            " provider_kind=excluded.provider_kind,"
            " model=excluded.model,"
            " dimensions=excluded.dimensions,"
            " vector=excluded.vector,"
            " indexed_at=excluded.indexed_at",
            (
                memory_id,
                provider_id,
                provider_kind,
                model,
                len(vector),
                json.dumps(vector),
                _now_iso(),
            ),
        )
        self._conn.commit()

    def delete_memory_embedding(self, memory_id: str) -> bool:
        cursor = self._conn.execute(
            "DELETE FROM memory_embeddings WHERE memory_id = ?",
            (memory_id,),
        )
        self._conn.commit()
        return cursor.rowcount > 0

    def get_memory_embedding(self, memory_id: str) -> dict[str, Any] | None:
        row = self._conn.execute(
            "SELECT * FROM memory_embeddings WHERE memory_id = ?",
            (memory_id,),
        ).fetchone()
        if row is None:
            return None
        item = dict(row)
        item["vector"] = json.loads(item["vector"])
        return item

    def list_memory_embeddings(
        self,
        *,
        persona_id: str | None = None,
        include_global: bool = True,
    ) -> list[dict[str, Any]]:
        if persona_id is None:
            rows = self._conn.execute(
                "SELECT m.*, e.provider_id, e.provider_kind, e.model, e.dimensions, e.vector, e.indexed_at"
                " FROM memories m JOIN memory_embeddings e ON e.memory_id = m.id"
                " ORDER BY m.updated_at DESC"
            ).fetchall()
        elif include_global:
            rows = self._conn.execute(
                "SELECT m.*, e.provider_id, e.provider_kind, e.model, e.dimensions, e.vector, e.indexed_at"
                " FROM memories m JOIN memory_embeddings e ON e.memory_id = m.id"
                " WHERE m.persona_id = ? OR m.persona_id = ''"
                " ORDER BY m.updated_at DESC",
                (persona_id,),
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT m.*, e.provider_id, e.provider_kind, e.model, e.dimensions, e.vector, e.indexed_at"
                " FROM memories m JOIN memory_embeddings e ON e.memory_id = m.id"
                " WHERE m.persona_id = ?"
                " ORDER BY m.updated_at DESC",
                (persona_id,),
            ).fetchall()
        result = []
        for row in rows:
            item = dict(row)
            item["tags"] = json.loads(item["tags"])
            item["vector"] = json.loads(item["vector"])
            result.append(item)
        return result

    def count_memory_embeddings(self) -> int:
        row = self._conn.execute("SELECT COUNT(*) FROM memory_embeddings").fetchone()
        return row[0] if row else 0


# ---------------------------------------------------------------------------
# MemoryManager
# ---------------------------------------------------------------------------


class MemoryManager:
    """Higher-level memory operations combining store access with retention-mode logic."""

    def __init__(
        self,
        store: MemoryStore,
        *,
        enabled: bool = True,
        embeddings: "EmbeddingsGateway | None" = None,
    ) -> None:
        self.store = store
        self.enabled = enabled
        self.embeddings = embeddings

    @classmethod
    def from_db_path(
        cls,
        db_path: Path,
        *,
        enabled: bool = True,
        embeddings: "EmbeddingsGateway | None" = None,
    ) -> "MemoryManager":
        return cls(store=MemoryStore(db_path), enabled=enabled, embeddings=embeddings)

    def persist_conversation_turn(
        self,
        *,
        user_message: str,
        assistant_response: str,
        persona_id: str = "",
        session_id: str = "",
        retention_mode: str = "transcript_and_summary",
        provider_id: str = "",
        model: str = "",
        latency_ms: int | None = None,
    ) -> str | None:
        """Store a single user/assistant exchange.  Returns conversation_id or None if disabled."""
        if not self.enabled or not user_message.strip():
            return None

        conv_id = self.store.insert_conversation(
            persona_id=persona_id,
            session_id=session_id,
            retention_mode=retention_mode,
        )

        if retention_mode in ("full_transcript", "transcript_and_summary"):
            self.store.insert_message(conversation_id=conv_id, role="user", content=user_message)
            self.store.insert_message(
                conversation_id=conv_id,
                role="assistant",
                content=assistant_response,
                provider_id=provider_id,
                model=model,
                latency_ms=latency_ms,
            )

        self.store.close_conversation(conv_id)
        return conv_id

    def get_stats(self) -> dict[str, int]:
        return {
            "conversations": self.store.count_conversations(),
            "messages": self.store.count_messages(),
            "preferences": self.store.count_preferences(),
            "memories": self.store.count_memories(),
            "indexed_memories": self.store.count_memory_embeddings(),
        }

    def create_memory_entry(
        self,
        *,
        content: str,
        persona_id: str = "",
        source: str = "manual",
        tags: list[str] | None = None,
    ) -> dict[str, Any]:
        memory_id = self.store.insert_memory(
            content=content,
            persona_id=persona_id,
            source=source,
            tags=tags,
        )
        self.index_memory(memory_id)
        return self.store.get_memory(memory_id)  # type: ignore[return-value]

    def update_memory_entry(
        self,
        memory_id: str,
        *,
        content: str | None = None,
        tags: list[str] | None = None,
    ) -> dict[str, Any] | None:
        if not self.store.update_memory(memory_id, content=content, tags=tags):
            return None
        self.index_memory(memory_id)
        return self.store.get_memory(memory_id)

    def delete_memory_entry(self, memory_id: str) -> bool:
        self.store.delete_memory_embedding(memory_id)
        return self.store.delete_memory(memory_id)

    def index_memory(self, memory_id: str) -> dict[str, Any] | None:
        if self.embeddings is None:
            return None
        memory = self.store.get_memory(memory_id)
        if memory is None:
            return None
        result = self.embeddings.embed_text(self._embedding_text(memory))
        self.store.upsert_memory_embedding(
            memory_id=memory_id,
            provider_id=result.provider_id,
            provider_kind=result.provider_kind,
            model=result.model,
            vector=result.vector,
        )
        return {
            "memory_id": memory_id,
            "provider_id": result.provider_id,
            "provider_kind": result.provider_kind,
            "model": result.model,
            "dimensions": len(result.vector),
            "duration_ms": result.duration_ms,
        }

    def index_memories(self, *, persona_id: str | None = None) -> dict[str, int]:
        indexed = 0
        failed = 0
        for memory in self.store.list_memories(persona_id=persona_id, limit=1000):
            try:
                if self.index_memory(memory["id"]) is not None:
                    indexed += 1
            except EmbeddingProviderError:
                failed += 1
        return {"indexed": indexed, "failed": failed}

    def search_relevant_memories(
        self,
        query: str,
        *,
        persona_id: str = "",
        limit: int = 5,
        min_score: float = 0.05,
    ) -> list[dict[str, Any]]:
        if not self.enabled or self.embeddings is None or not query.strip():
            return []

        self._ensure_searchable_memories(persona_id=persona_id)
        query_result = self.embeddings.embed_text(query.strip())
        rows = self.store.list_memory_embeddings(persona_id=persona_id or None, include_global=True)
        scored: list[dict[str, Any]] = []
        for row in rows:
            score = cosine_similarity(query_result.vector, row["vector"])
            if score < min_score:
                continue
            scored.append(
                {
                    "id": row["id"],
                    "persona_id": row["persona_id"],
                    "content": row["content"],
                    "source": row["source"],
                    "tags": row["tags"],
                    "score": round(score, 4),
                    "embedding": {
                        "provider_id": row["provider_id"],
                        "provider_kind": row["provider_kind"],
                        "model": row["model"],
                        "dimensions": row["dimensions"],
                        "indexed_at": row["indexed_at"],
                    },
                }
            )
        scored.sort(key=lambda item: item["score"], reverse=True)
        return scored[:limit]

    def _ensure_searchable_memories(self, *, persona_id: str = "") -> None:
        for memory in self.store.list_memories(limit=1000):
            if persona_id and memory["persona_id"] not in ("", persona_id):
                continue
            embedding = self.store.get_memory_embedding(memory["id"])
            if embedding is not None:
                continue
            self.index_memory(memory["id"])

    @staticmethod
    def _embedding_text(memory: dict[str, Any]) -> str:
        tags = " ".join(memory.get("tags") or [])
        return f"{memory.get('content', '')}\n{tags}".strip()
