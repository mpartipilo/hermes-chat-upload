import importlib.util
import io
import json
import sys
import types
import zipfile
from pathlib import Path

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

ROOT = Path(__file__).resolve().parents[1]
API = ROOT / "dashboard" / "plugin_api.py"

@pytest.fixture()
def api(tmp_path, monkeypatch):
    shim = types.ModuleType("hermes_constants")
    shim.get_hermes_home = lambda: tmp_path
    monkeypatch.setitem(sys.modules, "hermes_constants", shim)
    spec = importlib.util.spec_from_file_location("plugin_api_under_test", API)
    mod = importlib.util.module_from_spec(spec)
    sys.modules["plugin_api_under_test"] = mod
    spec.loader.exec_module(mod)
    return mod

@pytest.fixture()
def client(api):
    app = FastAPI()
    app.include_router(api.router)
    return TestClient(app)

def test_health_v200(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json()["version"] == "2.0.1"
    assert r.json()["ok"] is True

def test_tool_status_map(api):
    cases = {"web_search":"searching","terminal":"running","browser_click":"browsing","delegate_task":"delegating","write_file":"writing","read_file":"reading","unknown":"working"}
    for name, expected in cases.items():
        assert api._tool_label(name) == expected

def test_upload_resolve_file_and_bulk(client, tmp_path):
    sid = "test-session"
    paths = []
    for i, name in enumerate(["a.png", "b.pdf", "c.csv"]):
        r = client.post("/upload", data={"session_id": sid}, files={"file": (name, io.BytesIO(f"data-{i}".encode()), "application/octet-stream")})
        assert r.status_code == 200, r.text
        data = r.json()
        assert data["path"].startswith(str(tmp_path / "plugins" / "chat-upload" / "uploads" / sid))
        paths.append(data["path"])
    rr = client.get("/resolve", params={"path": paths[0]})
    assert rr.json()["exists"] is True
    fr = client.get("/file", params={"path": paths[0]})
    assert fr.status_code == 200
    zr = client.post("/bulk-download", json={"paths": paths})
    assert zr.status_code == 200
    with zipfile.ZipFile(io.BytesIO(zr.content)) as zf:
        assert len(zf.namelist()) == 3

def test_upload_security(client):
    bad = client.post("/upload", data={"session_id": "../evil"}, files={"file": ("x.txt", io.BytesIO(b"x"), "text/plain")})
    assert bad.status_code == 400
    outside = client.get("/file", params={"path": "/etc/passwd"})
    assert outside.status_code == 403

def test_session_roundtrip_and_delete(client, tmp_path):
    body = {"title": "hello", "messages": [{"role":"user","text":"hello"},{"role":"assistant","text":"hi"}]}
    r = client.post("/sessions", json=body)
    assert r.status_code == 200
    sid = r.json()["session_id"]
    assert client.get(f"/sessions/{sid}").json()["messages"][1]["text"] == "hi"
    listed = client.get("/sessions").json()["sessions"]
    assert listed and listed[0]["session_id"] == sid
    d = client.delete(f"/sessions/{sid}")
    assert d.json()["ok"] is True
    assert client.get(f"/sessions/{sid}").status_code == 404

def test_frontend_contains_required_markers():
    src = (ROOT / "dashboard" / "src" / "index.jsx").read_text()
    dist = (ROOT / "dashboard" / "dist" / "index.js").read_text()
    for marker in ["marked", "cu-md table", "onPaste", "onDrop", "bulk-download", "localStorage", "WebSocket", "Status"]:
        assert marker in src
    assert "DOMPurify.sanitize" in src
    assert "ADD_ATTR" in src
    assert ".sanitize(" in dist
    assert "ADD_ATTR" in dist


def test_frontend_persists_initial_generated_session_id():
    src = (ROOT / "dashboard" / "src" / "index.jsx").read_text()
    assert 'localStorage.setItem("chat-upload.session_id",saved)' in src


def test_frontend_header_does_not_render_raw_session_id():
    src = (ROOT / "dashboard" / "src" / "index.jsx").read_text()
    header = src.split('React.createElement("div",{className:"cu-top"}', 1)[1].split('React.createElement("div",{className:"cu-messages",ref:scrollRef}', 1)[0]
    assert "sessionId" not in header

def test_manifest_and_backend_versions_match():
    manifest = json.loads((ROOT / "dashboard" / "manifest.json").read_text())
    api_text = API.read_text()
    assert manifest["version"] == "2.0.1"
    assert 'PLUGIN_VERSION = "2.0.1"' in api_text
    assert "hermes chat -Q" not in api_text


def test_agent_history_conversion_uses_prior_ui_messages(api):
    ui_messages = [
        {"role": "user", "text": "generate a black hole image", "timestamp": 1},
        {"role": "assistant", "content": "Created MEDIA:/tmp/black-hole.png", "timestamp": 2},
        {"role": "system", "text": "ignore me"},
        {"role": "assistant", "text": ""},
    ]

    assert api._agent_history_from_chat_upload(ui_messages) == [
        {"role": "user", "content": "generate a black hole image"},
        {"role": "assistant", "content": "Created MEDIA:/tmp/black-hole.png"},
    ]


def test_agent_turn_reuses_session_messages(api):
    class FakeAgent:
        def __init__(self):
            self._session_messages = [
                {"role": "user", "content": "generate a black hole image"},
                {"role": "assistant", "content": "Created MEDIA:/tmp/black-hole.png"},
            ]
            self.calls = []

        def run_conversation(self, message, conversation_history=None):
            self.calls.append((message, list(conversation_history or [])))
            self._session_messages = list(conversation_history or []) + [
                {"role": "user", "content": message},
                {"role": "assistant", "content": "yes, the black hole image"},
            ]
            return {"final_response": "yes, the black hole image"}

    agent = FakeAgent()
    response = api._run_agent_turn(agent, "are you aware of what you just created?")

    assert response == "yes, the black hole image"
    assert agent.calls[0][1] == [
        {"role": "user", "content": "generate a black hole image"},
        {"role": "assistant", "content": "Created MEDIA:/tmp/black-hole.png"},
    ]


def test_active_agent_registry_seeds_reuses_and_lru_evicts(api, monkeypatch):
    created = []

    class FakeAgent:
        def __init__(self, **kwargs):
            self.kwargs = kwargs
            self._session_messages = []
            created.append(self)

    monkeypatch.setattr(api, "_ACTIVE_AGENT_MAX", 2)
    first = api._get_active_agent(
        "s1",
        "default",
        FakeAgent,
        history=[{"role": "user", "content": "first turn"}],
        callbacks={},
    )
    again = api._get_active_agent("s1", "default", FakeAgent, history=[], callbacks={})
    second = api._get_active_agent("s2", "default", FakeAgent, history=[], callbacks={})
    third = api._get_active_agent("s3", "default", FakeAgent, history=[], callbacks={})

    assert again is first
    assert first._session_messages == [{"role": "user", "content": "first turn"}]
    assert second is not third
    assert "s1" not in api._active_agents
    assert list(api._active_agents) == ["s2", "s3"]


def test_session_lock_is_stable_per_session(api):
    assert api._session_lock("same-session") is api._session_lock("same-session")
    assert api._session_lock("same-session") is not api._session_lock("other-session")


def test_perf_client_beacon_and_summary(api, client, tmp_path):
    r = client.post("/perf/client", json={"event": "keystroke", "p50_ms": 4.2, "p95_ms": 11.0, "max_ms": 40.0, "count": 30, "message_count": 12})
    assert r.status_code == 200
    assert r.json()["ok"] is True
    perf_file = tmp_path / "plugins" / "web-chat" / "perf" / "client.jsonl"
    assert perf_file.exists()
    r2 = client.get("/perf/summary", params={"hours": 24})
    assert r2.status_code == 200
    body = r2.json()
    assert body["client_keystroke_p95_ms"]["count"] == 1
    assert body["client_keystroke_p95_ms"]["p95_ms"] == 11.0


def test_perf_summary_aggregates_turns(api, tmp_path):
    api._perf_append("turns.jsonl", {"session_id": "s1", "ok": True, "total_ms": 500.0, "first_delta_ms": 200.0})
    api._perf_append("turns.jsonl", {"session_id": "s1", "ok": True, "total_ms": 1500.0, "first_delta_ms": 900.0})
    api._perf_append("turns.jsonl", {"session_id": "s2", "ok": False, "total_ms": 4000.0, "first_delta_ms": None})
    stats = api._perf_read("turns.jsonl")
    assert len(stats) == 3
    total_ms = [t["total_ms"] for t in stats]
    agg = api._perf_stats(total_ms)
    assert agg["count"] == 3
    assert agg["max_ms"] == 4000.0
    failures = [t for t in stats if not t.get("ok", True)]
    assert len(failures) == 1


def test_perf_read_respects_since_window(api, tmp_path):
    import time as _time
    api._perf_append("client.jsonl", {"event": "keystroke", "p95_ms": 999.0, "ts": _time.time() - 100000})
    api._perf_append("client.jsonl", {"event": "keystroke", "p95_ms": 5.0, "ts": _time.time()})
    recent = api._perf_read("client.jsonl", since_s=_time.time() - 60)
    assert len(recent) == 1
    assert recent[0]["p95_ms"] == 5.0
