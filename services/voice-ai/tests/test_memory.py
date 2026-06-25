"""Tests for the SQLite memory module, MemoryManager, and memory API routes."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.memory import MemoryManager, MemoryStore


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture()
def db_path(tmp_path: Path) -> Path:
    return tmp_path / "test_memory.db"


@pytest.fixture()
def store(db_path: Path) -> MemoryStore:
    return MemoryStore(db_path)


@pytest.fixture()
def manager(db_path: Path) -> MemoryManager:
    return MemoryManager.from_db_path(db_path)


# ---------------------------------------------------------------------------
# MemoryStore - schema creation
# ---------------------------------------------------------------------------


def test_store_creates_db_and_tables(db_path: Path) -> None:
    store = MemoryStore(db_path)
    assert db_path.exists()
    tables = {
        row[0]
        for row in store._conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
    }
    assert {"conversations", "messages", "summaries", "preferences", "memories"}.issubset(tables)


# ---------------------------------------------------------------------------
# Conversations CRUD
# ---------------------------------------------------------------------------


def test_insert_and_get_conversation(store: MemoryStore) -> None:
    conv_id = store.insert_conversation(persona_id="eternity-infinity", retention_mode="full_transcript")
    conv = store.get_conversation(conv_id)
    assert conv is not None
    assert conv["persona_id"] == "eternity-infinity"
    assert conv["retention_mode"] == "full_transcript"
    assert conv["message_count"] == 0
    assert conv["ended_at"] is None


def test_close_conversation_sets_ended_at(store: MemoryStore) -> None:
    conv_id = store.insert_conversation()
    store.close_conversation(conv_id)
    conv = store.get_conversation(conv_id)
    assert conv["ended_at"] is not None


def test_list_conversations_all(store: MemoryStore) -> None:
    store.insert_conversation(persona_id="a")
    store.insert_conversation(persona_id="b")
    rows = store.list_conversations()
    assert len(rows) == 2


def test_list_conversations_filter_persona(store: MemoryStore) -> None:
    store.insert_conversation(persona_id="x")
    store.insert_conversation(persona_id="y")
    rows = store.list_conversations(persona_id="x")
    assert len(rows) == 1
    assert rows[0]["persona_id"] == "x"


def test_delete_conversation_cascades_messages(store: MemoryStore) -> None:
    conv_id = store.insert_conversation()
    store.insert_message(conversation_id=conv_id, role="user", content="hello")
    deleted = store.delete_conversation(conv_id)
    assert deleted is True
    assert store.get_conversation(conv_id) is None
    assert store.list_messages(conv_id) == []


def test_delete_conversation_returns_false_if_missing(store: MemoryStore) -> None:
    assert store.delete_conversation("does-not-exist") is False


def test_count_conversations(store: MemoryStore) -> None:
    assert store.count_conversations() == 0
    store.insert_conversation(persona_id="p")
    store.insert_conversation(persona_id="p")
    store.insert_conversation(persona_id="q")
    assert store.count_conversations() == 3
    assert store.count_conversations(persona_id="p") == 2
    assert store.count_conversations(persona_id="q") == 1


# ---------------------------------------------------------------------------
# Messages
# ---------------------------------------------------------------------------


def test_insert_message_increments_count(store: MemoryStore) -> None:
    conv_id = store.insert_conversation()
    store.insert_message(conversation_id=conv_id, role="user", content="hi")
    conv = store.get_conversation(conv_id)
    assert conv["message_count"] == 1


def test_list_messages_ordered_by_timestamp(store: MemoryStore) -> None:
    conv_id = store.insert_conversation()
    store.insert_message(conversation_id=conv_id, role="user", content="first")
    store.insert_message(conversation_id=conv_id, role="assistant", content="second")
    msgs = store.list_messages(conv_id)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[1]["role"] == "assistant"


def test_count_messages(store: MemoryStore) -> None:
    assert store.count_messages() == 0
    conv_id = store.insert_conversation()
    store.insert_message(conversation_id=conv_id, role="user", content="a")
    store.insert_message(conversation_id=conv_id, role="assistant", content="b")
    assert store.count_messages() == 2


# ---------------------------------------------------------------------------
# Summaries
# ---------------------------------------------------------------------------


def test_insert_and_list_summaries(store: MemoryStore) -> None:
    conv_id = store.insert_conversation()
    store.insert_summary(conversation_id=conv_id, content="Summary text")
    summaries = store.list_summaries(conv_id)
    assert len(summaries) == 1
    assert summaries[0]["content"] == "Summary text"


# ---------------------------------------------------------------------------
# Preferences
# ---------------------------------------------------------------------------


def test_set_and_get_preference_global(store: MemoryStore) -> None:
    store.set_preference("theme", "dark")
    assert store.get_preference("theme") == "dark"


def test_set_and_get_preference_persona_scoped(store: MemoryStore) -> None:
    store.set_preference("lang", "fr", persona_id="eternity-infinity")
    assert store.get_preference("lang", persona_id="eternity-infinity") == "fr"
    assert store.get_preference("lang") is None


def test_set_preference_overwrites_existing(store: MemoryStore) -> None:
    store.set_preference("speed", "fast")
    store.set_preference("speed", "slow")
    assert store.get_preference("speed") == "slow"


def test_delete_preference(store: MemoryStore) -> None:
    store.set_preference("x", 42)
    assert store.delete_preference("x") is True
    assert store.get_preference("x") is None
    assert store.delete_preference("x") is False


def test_list_preferences(store: MemoryStore) -> None:
    store.set_preference("a", 1)
    store.set_preference("b", 2)
    store.set_preference("c", 3, persona_id="p")
    all_prefs = store.list_preferences()
    assert len(all_prefs) == 3
    scoped = store.list_preferences(persona_id="p")
    assert len(scoped) == 1
    assert scoped[0]["key"] == "c"


def test_preference_value_types(store: MemoryStore) -> None:
    store.set_preference("int_val", 99)
    store.set_preference("list_val", [1, 2, 3])
    store.set_preference("dict_val", {"key": "value"})
    assert store.get_preference("int_val") == 99
    assert store.get_preference("list_val") == [1, 2, 3]
    assert store.get_preference("dict_val") == {"key": "value"}


def test_count_preferences(store: MemoryStore) -> None:
    assert store.count_preferences() == 0
    store.set_preference("k1", "v")
    store.set_preference("k2", "v")
    assert store.count_preferences() == 2


# ---------------------------------------------------------------------------
# Memory entries (facts)
# ---------------------------------------------------------------------------


def test_insert_and_get_memory(store: MemoryStore) -> None:
    mem_id = store.insert_memory(content="The universe is ancient.", tags=["cosmos", "lore"])
    entry = store.get_memory(mem_id)
    assert entry is not None
    assert entry["content"] == "The universe is ancient."
    assert entry["tags"] == ["cosmos", "lore"]
    assert entry["source"] == "manual"
    assert entry["persona_id"] == ""


def test_insert_memory_persona_scoped(store: MemoryStore) -> None:
    mem_id = store.insert_memory(content="Fact for narrator.", persona_id="eternity-infinity")
    entry = store.get_memory(mem_id)
    assert entry["persona_id"] == "eternity-infinity"


def test_update_memory_content(store: MemoryStore) -> None:
    mem_id = store.insert_memory(content="Old content")
    updated = store.update_memory(mem_id, content="New content")
    assert updated is True
    assert store.get_memory(mem_id)["content"] == "New content"


def test_update_memory_tags(store: MemoryStore) -> None:
    mem_id = store.insert_memory(content="Some fact", tags=["old"])
    store.update_memory(mem_id, tags=["new", "updated"])
    assert store.get_memory(mem_id)["tags"] == ["new", "updated"]


def test_update_memory_returns_false_if_missing(store: MemoryStore) -> None:
    assert store.update_memory("nonexistent") is False


def test_delete_memory(store: MemoryStore) -> None:
    mem_id = store.insert_memory(content="Will be deleted")
    assert store.delete_memory(mem_id) is True
    assert store.get_memory(mem_id) is None
    assert store.delete_memory(mem_id) is False


def test_list_memories_all(store: MemoryStore) -> None:
    store.insert_memory(content="Fact A")
    store.insert_memory(content="Fact B", persona_id="p")
    rows = store.list_memories()
    assert len(rows) == 2


def test_list_memories_persona_filter(store: MemoryStore) -> None:
    store.insert_memory(content="Global")
    store.insert_memory(content="Scoped", persona_id="p")
    rows = store.list_memories(persona_id="p")
    assert len(rows) == 1
    assert rows[0]["content"] == "Scoped"


def test_count_memories(store: MemoryStore) -> None:
    assert store.count_memories() == 0
    store.insert_memory(content="One")
    store.insert_memory(content="Two")
    assert store.count_memories() == 2


# ---------------------------------------------------------------------------
# MemoryManager
# ---------------------------------------------------------------------------


def test_manager_persist_turn_full_transcript(manager: MemoryManager) -> None:
    conv_id = manager.persist_conversation_turn(
        user_message="Hello",
        assistant_response="Hi there",
        persona_id="test-persona",
        retention_mode="full_transcript",
    )
    assert conv_id is not None
    conv = manager.store.get_conversation(conv_id)
    assert conv["persona_id"] == "test-persona"
    assert conv["ended_at"] is not None
    msgs = manager.store.list_messages(conv_id)
    assert len(msgs) == 2
    assert msgs[0]["role"] == "user"
    assert msgs[1]["role"] == "assistant"


def test_manager_persist_turn_summary_only(manager: MemoryManager) -> None:
    conv_id = manager.persist_conversation_turn(
        user_message="Hello",
        assistant_response="Response",
        retention_mode="summary_only",
    )
    assert conv_id is not None
    msgs = manager.store.list_messages(conv_id)
    assert len(msgs) == 0


def test_manager_persist_turn_disabled(db_path: Path) -> None:
    disabled = MemoryManager.from_db_path(db_path, enabled=False)
    result = disabled.persist_conversation_turn(user_message="x", assistant_response="y")
    assert result is None


def test_manager_persist_turn_empty_message_skipped(manager: MemoryManager) -> None:
    result = manager.persist_conversation_turn(user_message="  ", assistant_response="y")
    assert result is None


def test_manager_get_stats(manager: MemoryManager) -> None:
    manager.persist_conversation_turn(
        user_message="test",
        assistant_response="response",
        retention_mode="full_transcript",
    )
    manager.store.set_preference("key", "val")
    manager.store.insert_memory(content="fact")
    stats = manager.get_stats()
    assert stats["conversations"] == 1
    assert stats["messages"] == 2
    assert stats["preferences"] == 1
    assert stats["memories"] == 1


# ---------------------------------------------------------------------------
# Memory API endpoints
# ---------------------------------------------------------------------------


def test_api_memory_stats(client: TestClient) -> None:
    resp = client.get("/api/v1/memory/stats")
    assert resp.status_code == 200
    data = resp.json()
    assert "conversations" in data
    assert "messages" in data
    assert "preferences" in data
    assert "memories" in data


def test_api_memory_conversations_empty(client: TestClient) -> None:
    resp = client.get("/api/v1/memory/conversations")
    assert resp.status_code == 200
    data = resp.json()
    assert data["items"] == []
    assert data["total"] == 0


def test_api_memory_conversation_not_found(client: TestClient) -> None:
    resp = client.get("/api/v1/memory/conversations/nonexistent-id")
    assert resp.status_code == 404


def test_api_memory_conversation_delete_not_found(client: TestClient) -> None:
    resp = client.delete("/api/v1/memory/conversations/nonexistent-id")
    assert resp.status_code == 404


def test_api_memory_preferences_empty(client: TestClient) -> None:
    resp = client.get("/api/v1/memory/preferences")
    assert resp.status_code == 200
    assert resp.json()["items"] == []


def test_api_memory_preference_set_and_get(client: TestClient) -> None:
    resp = client.put("/api/v1/memory/preferences/theme", json={"value": "dark"})
    assert resp.status_code == 200
    data = resp.json()
    assert data["key"] == "theme"
    assert data["value"] == "dark"

    prefs = client.get("/api/v1/memory/preferences").json()
    assert any(p["key"] == "theme" for p in prefs["items"])


def test_api_memory_preference_delete(client: TestClient) -> None:
    client.put("/api/v1/memory/preferences/tmp-key", json={"value": 1})
    resp = client.delete("/api/v1/memory/preferences/tmp-key")
    assert resp.status_code == 204

    resp2 = client.delete("/api/v1/memory/preferences/tmp-key")
    assert resp2.status_code == 404


def test_api_memory_preference_persona_scoped(client: TestClient) -> None:
    client.put("/api/v1/memory/preferences/lang?persona_id=eternity-infinity", json={"value": "fr"})
    # Global should be absent
    prefs_global = client.get("/api/v1/memory/preferences").json()
    global_keys = {p["key"] for p in prefs_global["items"]}
    # Persona-scoped preference is returned when listing all
    assert "lang" in global_keys
    # Also accessible when filtering by persona
    prefs_p = client.get("/api/v1/memory/preferences?persona_id=eternity-infinity").json()
    assert any(p["key"] == "lang" for p in prefs_p["items"])


def test_api_memory_entries_empty(client: TestClient) -> None:
    resp = client.get("/api/v1/memory/entries")
    assert resp.status_code == 200
    assert resp.json()["items"] == []


def test_api_memory_entries_create(client: TestClient) -> None:
    payload = {"content": "The deep space holds infinite mysteries.", "tags": ["space", "lore"]}
    resp = client.post("/api/v1/memory/entries", json=payload)
    assert resp.status_code == 201
    data = resp.json()
    assert data["content"] == payload["content"]
    assert data["tags"] == payload["tags"]
    assert "id" in data


def test_api_memory_entries_update(client: TestClient) -> None:
    created = client.post("/api/v1/memory/entries", json={"content": "Original"}).json()
    entry_id = created["id"]
    resp = client.put(f"/api/v1/memory/entries/{entry_id}", json={"content": "Updated", "tags": ["new"]})
    assert resp.status_code == 200
    assert resp.json()["content"] == "Updated"
    assert resp.json()["tags"] == ["new"]


def test_api_memory_entries_delete(client: TestClient) -> None:
    created = client.post("/api/v1/memory/entries", json={"content": "To delete"}).json()
    entry_id = created["id"]
    resp = client.delete(f"/api/v1/memory/entries/{entry_id}")
    assert resp.status_code == 204

    resp2 = client.delete(f"/api/v1/memory/entries/{entry_id}")
    assert resp2.status_code == 404


def test_api_memory_entries_update_not_found(client: TestClient) -> None:
    resp = client.put("/api/v1/memory/entries/nonexistent", json={"content": "x"})
    assert resp.status_code == 404


def test_api_memory_entries_delete_not_found(client: TestClient) -> None:
    resp = client.delete("/api/v1/memory/entries/nonexistent")
    assert resp.status_code == 404


def test_api_memory_entries_require_content(client: TestClient) -> None:
    resp = client.post("/api/v1/memory/entries", json={"content": ""})
    assert resp.status_code == 422


# ---------------------------------------------------------------------------
# Conversation integration — text turn is persisted
# ---------------------------------------------------------------------------


class _FakeResponse:
    status_code = 200

    def raise_for_status(self) -> None:
        pass

    def json(self) -> dict:
        return {"response": "Greetings from the cosmos."}


class _FakeLlmClient:
    def __init__(self, timeout: int) -> None:
        pass

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def post(self, url: str, json: dict) -> _FakeResponse:
        return _FakeResponse()


def test_submit_text_persists_turn(client: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    """A successful text conversation must persist a conversation + 2 messages to SQLite."""
    from app.providers import llm as llm_module

    # Give the default provider a model so the LLM gateway doesn't reject it.
    providers = client.get("/api/v1/config/providers").json()
    providers["llm"]["providers"]["ollama_local"]["model"] = "llama3"
    client.put("/api/v1/config/providers", json=providers)

    monkeypatch.setattr(llm_module.httpx, "Client", _FakeLlmClient)

    resp = client.post(
        "/api/v1/conversation/text",
        json={"message": "Who are you?", "persona_id": "eternity-infinity"},
    )
    assert resp.status_code == 200

    stats = client.get("/api/v1/memory/stats").json()
    assert stats["conversations"] >= 1
    assert stats["messages"] >= 2
