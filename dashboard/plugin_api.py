"""web-chat dashboard plugin v2.1.0.

Mounted by the Hermes dashboard at /api/plugins/web-chat/.
In-browser chat with real Hermes sessions (state.db), uploads, clarify
cards, and model/effort selection.
"""
from __future__ import annotations

import asyncio
import contextlib
import hmac
import io
import json
import logging
import mimetypes
import os
import re
import shutil
import sys
import threading
import time
import uuid
import zipfile
from collections import OrderedDict
from concurrent.futures import Future as _ThreadFuture
from concurrent.futures import TimeoutError as _FutureTimeout
from pathlib import Path
from typing import Any, Callable, Optional

from fastapi import APIRouter, File, Form, HTTPException, Query, Request, UploadFile, WebSocket, WebSocketDisconnect
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel

try:
    from hermes_constants import get_hermes_home
except Exception:  # test fallback
    def get_hermes_home():  # type: ignore
        return Path.home() / ".hermes"

log = logging.getLogger(__name__)
router = APIRouter()
PLUGIN_VERSION = "1.0.0"
_MAX_FILE_BYTES = int(os.getenv("HERMES_UPLOAD_MAX_BYTES", str(100 * 1024 * 1024)))
_MAX_BULK_FILES = 100
_SESSION_RE = re.compile(r"^[A-Za-z0-9_.-]{1,96}$")
_LAST_CLEANUP = 0.0
_ACTIVE_AGENT_MAX = int(os.getenv("HERMES_CHAT_UPLOAD_ACTIVE_AGENTS", "16"))
_active_agents: "OrderedDict[str, Any]" = OrderedDict()
_active_agent_profiles: dict[str, Optional[str]] = {}
_active_agent_models: dict[str, str] = {}
_active_agent_dbs: dict[str, Any] = {}
_session_locks: dict[str, asyncio.Lock] = {}
# WS-stream identity: the dashboard keeps one plugin WS per tab; the last writer
# for a session owns its clarify round-trips. Keys = session_id, values = ws object.
_ws_by_session: dict[str, WebSocket] = {}
# In-flight clarify cards: request_id (uuid4) -> ({question, choices, multi_select, ws, answers, done})
# The answers dict holds qid -> raw answer for the batch shape; single-question path
# stores under the single "qanswer" key. `done` is a threading.Event set when the
# browser answers (or the timeout fires); the agent thread waits on it.
_pending_clarify: dict[str, dict[str, Any]] = {}

# Serve-backend clarify cards awaiting a browser answer: request_id -> {session_id,
# client, params}. Separate from _pending_clarify (which owns the in-process agent's
# threading.Event round trip); here the gateway owns the blocking and we just need
# enough context to route the answer back over the right client.
_serve_clarify_pending: dict[str, dict[str, Any]] = {}

# Upper bound on how many sessions the badge poll probes per tick: the endpoint
# runs on a timer, so an unbounded scan would grow with session count.
_CLARIFY_SCAN_LIMIT = int(os.getenv("HERMES_CHAT_CLARIFY_SCAN_LIMIT", "25"))

# Rewind under the serve backend is DEFERRED, not immediate: hermes serve has no
# truncate-only RPC (session.undo only drops the LAST turn), and a direct state.db
# rewind does NOT touch a live session's in-memory history -- verified: the DB
# reported rewound_count=3 while session.resume still returned all 4 messages, so
# the agent would silently keep the "edited away" turns. The only correct cut is
# prompt.submit's own `truncate_before_row_id` + `confirm_truncate`, which is
# atomic with the resend. So /rewind records the cut point here and the next
# /stream send applies it. session_id -> row_id.
_pending_truncate: dict[str, int] = {}

# `source` stamped on sessions web-chat creates via hermes serve, so the existing
# source-based cross-talk guard keeps recognizing them as web-chat's own.
_WEBCHAT_SOURCE = "dashboard-plugin:web-chat"
# Mirrors web/src/pages/SessionsPage.tsx AUTOMATION_SESSION_SOURCES so the
# web-chat session list matches the dashboard's default "Chats" filter.
_AUTOMATION_SESSION_SOURCES = ["cron", "tool", "api_server", "acp", "hermes_flow", "vulcan_delegate", "webhook"]

# TEMPORARY migration aid (see ~/.hermes/plans/2026-09-14_090000-web-chat-hermes-serve-backend.md).
# Routes reads through `hermes serve` RPC instead of direct state.db access so web-chat can see
# sessions live in OTHER processes (desktop/TUI) -- the root cause of invisible clarify prompts.
# DELETE this flag (and the DB fallback branches) in the plan's final cleanup task.
_USE_SERVE_BACKEND = os.getenv("HERMES_CHAT_USE_SERVE_BACKEND", "0") == "1"


def _serve_client(profile: Optional[str] = None):
    """Lazy import so a broken/absent serve_client never breaks the DB path."""
    from serve_client import get_client
    return get_client(profile)


async def _serve_active_status_map(profile: Optional[str] = None) -> dict[str, str]:
    """`session.active_list` -> {session_key: status} for every session live in
    THIS profile's hermes serve process right now -- desktop/TUI/web-chat share one
    process per profile, and `_sessions` (the map this RPC snapshots) is process-
    global with no transport scoping, so this sees a turn driven by ANY surface,
    not just ones web-chat itself opened. ONE call covers the whole list (unlike
    the clarify badge's necessary per-session gather -- active_list has no
    per-session fan-out cost since it's already a full-process snapshot).

    Keyed on `session_key` (the PERSISTED id, matching session.list's `id` field),
    NOT the row's own `id`, which is the ephemeral runtime id -- see session.resume's
    session_id-vs-session_key split documented in the migration plan's Task 0 finding.
    """
    try:
        result = await _serve_client(profile).rpc("session.active_list", {})
    except Exception:
        return {}
    out: dict[str, str] = {}
    for row in result.get("sessions") or []:
        key = row.get("session_key") or row.get("id")
        if key:
            out[str(key)] = row.get("status") or "idle"
    return out


def _serve_status_busy(status: str) -> bool:
    """active_list's `status` is one of idle/waiting/starting/working; treat
    anything but idle as busy -- "waiting" (blocked on clarify) still owns the
    turn and must not let a second prompt jump the queue, matching the existing
    _session_busy semantics (busy spans the whole in-flight window, not just
    active generation)."""
    return status not in ("", "idle")


def _map_serve_session_row(row: dict[str, Any], status_map: Optional[dict[str, str]] = None) -> dict[str, Any]:
    """`session.list` row -> the shape web-chat's frontend already consumes.

    Field parity is NOT exact (verified against tui_gateway's _session_row_summary):
    the RPC carries only id/title/preview/started_at/message_count/source, so
    `updated_at` falls back to started_at and `model` is unavailable here. The
    gateway also applies its OWN deny-list (kanban, tool) which differs from
    web-chat's automation set, so the automation filter is re-applied by the
    caller to keep the dashboard-parity the session list is supposed to have.

    `is_busy` ORs two sources: `_session_busy` (this web-chat process's OWN
    /stream WS registration, covers a turn this tab JUST started before the
    gateway's active_list snapshot catches up) and `status_map` (the gateway's
    process-wide view, which is what makes a desktop/TUI-driven turn show up as
    busy here too -- the actual Task 5 fix; see the plan's Task 3 note that this
    was deliberately deferred).
    """
    sid = row.get("id") or row.get("session_id")
    started = row.get("started_at") or 0
    is_busy = False
    if sid:
        is_busy = _session_busy(sid) or (bool(status_map) and _serve_status_busy(status_map.get(sid, "")))
    return {
        "session_id": sid,
        "title": row.get("title") or "New chat",
        "preview": (row.get("preview") or "")[:120],
        "created_at": started,
        "updated_at": started,
        "message_count": row.get("message_count") or 0,
        "source": row.get("source") or "",
        "model": "",
        "is_busy": is_busy,
    }


def _map_serve_message(m: dict[str, Any]) -> Optional[dict[str, Any]]:
    """`session.resume` message -> web-chat's UI message shape, or None to drop.

    tui_gateway's _history_to_messages already emits {role,text,...} and already
    drops hidden/empty rows, but it KEEPS role="tool" rows (web-chat's own
    _load_session_messages filters to user/assistant only). Preserve web-chat's
    existing behaviour so the transcript renders identically across the flag.
    It also exposes `row_id` -- the durable DB row identity the desktop's rewind
    uses -- which web-chat's edit-and-resend will need, so carry it through.
    """
    role = m.get("role")
    if role not in ("user", "assistant"):
        return None
    text = str(m.get("text") or m.get("content") or "").strip()
    if not text:
        return None
    out = {
        "id": m.get("row_id"),
        "role": role,
        "text": text,
        "content": text,
        "timestamp": m.get("timestamp") or time.time(),
    }
    if m.get("row_id") is not None:
        out["row_id"] = m["row_id"]
    return out


async def _load_session_via_serve(session_id: str, profile: Optional[str] = None) -> dict[str, Any]:
    """`session.resume` -> {messages, model, is_busy}. Uses the PERSISTED id
    (session_key/resumed) for identity, never the ephemeral runtime session_id."""
    result = await _serve_client(profile).rpc(
        "session.resume", {"session_id": session_id, "omit_messages": False})
    messages = [mm for mm in (_map_serve_message(m) for m in (result.get("messages") or [])) if mm]
    info = result.get("info") or {}
    return {
        "messages": messages,
        "model": info.get("model") or "",
        "is_busy": bool(result.get("running")),
        "session_key": result.get("session_key") or result.get("resumed") or session_id,
    }


async def _list_sessions_via_serve(profile: Optional[str] = None) -> list[dict[str, Any]]:
    """`session.list` + web-chat's own automation filter (gateway's deny-list is
    only {kanban, tool}; over-fetch so post-filtering still fills the page).

    Fetches `session.active_list` alongside `session.list` (one extra RPC, not
    per-row) so `is_busy` reflects a turn driven by ANY surface sharing this
    profile's hermes serve process -- see _map_serve_session_row. A status-map
    fetch failure degrades to "no live info", never to an exception: a stale/
    missing busy flag is a cosmetic miss, not worth failing the whole list for."""
    list_result, status_map = await asyncio.gather(
        _serve_client(profile).rpc("session.list", {"limit": 200}),
        _serve_active_status_map(profile))
    rows = list_result.get("sessions") or []
    denied = {s.lower() for s in _AUTOMATION_SESSION_SOURCES}
    out = [_map_serve_session_row(r, status_map) for r in rows
           if (r.get("source") or "").strip().lower() not in denied]
    return out[:50]
# Default raised from 300s (5min) -> 3600s (1hr): the old timeout silently
# expired clarify cards the user hadn'''t seen yet (backgrounded tab, mobile
# tab suspension, or simply not looking at that chat) -- the agent then
# barreled ahead and reported "No response came through" with no visible
# prompt ever having been shown. See hermes-chat-frontend skill incident log.
_CLARIFY_TIMEOUT = float(os.getenv("HERMES_CHAT_CLARIFY_TIMEOUT", "3600"))
_CLARIFY_WS_LOCK = threading.Lock()

_TOOL_STATUS_MAP = {
    "web_search": "searching", "web_extract": "searching",
    "terminal": "running", "process": "running", "execute_code": "running",
    "browser_navigate": "browsing", "browser_click": "browsing", "browser_type": "browsing",
    "browser_scroll": "browsing", "browser_snapshot": "browsing", "browser_press": "browsing",
    "browser_back": "browsing", "browser_vision": "browsing", "browser_get_images": "browsing",
    "browser_console": "browsing", "delegate_task": "delegating",
    "write_file": "writing", "patch": "writing", "read_file": "reading", "search_files": "reading",
}

_ALLOWED_EXTS = {
    "image": {".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".bmp", ".tiff"},
    "pdf": {".pdf"},
    "html": {".html", ".htm"},
    "audio": {".mp3", ".wav", ".m4a", ".ogg", ".flac", ".aac"},
    "video": {".mp4", ".mov", ".webm", ".mkv", ".avi"},
    "code": {".py", ".js", ".ts", ".jsx", ".tsx", ".css", ".sql", ".sh"},
    "data": {".json", ".yaml", ".yml", ".csv", ".md", ".txt", ".toml", ".xml"},
    "archive": {".zip", ".tar", ".gz", ".tgz", ".7z"},
}
_EXECUTABLE_EXTS = {".sh", ".bash", ".zsh", ".fish", ".exe", ".bat", ".cmd", ".ps1"}

class BulkRequest(BaseModel):
    paths: list[str]

class SessionSaveRequest(BaseModel):
    title: Optional[str] = None
    messages: list[dict[str, Any]] = []
    metadata: dict[str, Any] = {}


class ClarifyAnswerRequest(BaseModel):
    request_id: str
    answer: Optional[str] = None
    question_id: Optional[str] = None  # qid (q0..q4) for batch shape; None => single-question answer


class StopRequest(BaseModel):
    session_id: str


class SessionModelRequest(BaseModel):
    model: str


class RewindRequest(BaseModel):
    message_id: int


class ClientPerfRequest(BaseModel):
    # Frontend perf samples, aggregated client-side before sending (never one
    # beacon per event -- see PERF_PROFILER.md). event is one of "keystroke"
    # (keydown-to-paint), "longtask" (PerformanceObserver long-task, >=50ms
    # main-thread block), or "session_switch" (sidebar click to messages
    # painted). p50/p95/max are milliseconds; count = raw samples in this batch.
    event: str = "keystroke"
    p50_ms: float = 0.0
    p95_ms: float = 0.0
    max_ms: float = 0.0
    count: int = 0
    message_count: int = 0


def _root() -> Path:
    return Path(get_hermes_home()).expanduser() / "plugins" / "web-chat"

def _uploads_root() -> Path:
    p = _root() / "uploads"; p.mkdir(parents=True, exist_ok=True); return p

def _perf_root() -> Path:
    p = _root() / "perf"; p.mkdir(parents=True, exist_ok=True); return p

_PERF_MAX_LINES = int(os.getenv("HERMES_CHAT_PERF_MAX_LINES", "5000"))
_PERF_LOCK = threading.Lock()

def _perf_append(filename: str, record: dict[str, Any]) -> None:
    """Append one JSONL record, trimming to the last _PERF_MAX_LINES lines so
    the log never grows unbounded. Best-effort: perf logging must never break
    a chat turn, so every failure is swallowed."""
    try:
        path = _perf_root() / filename
        record = dict(record); record["ts"] = record.get("ts", time.time())
        with _PERF_LOCK:
            with path.open("a") as f:
                f.write(json.dumps(record) + "\n")
            # Cheap trim: only rewrite when meaningfully over budget, so a
            # normal append stays O(1) and we don't stat+rewrite every call.
            try:
                with path.open("r") as f:
                    lines = f.readlines()
                if len(lines) > _PERF_MAX_LINES * 1.2:
                    with path.open("w") as f:
                        f.writelines(lines[-_PERF_MAX_LINES:])
            except Exception:
                pass
    except Exception:
        log.debug("web-chat: perf log write failed", exc_info=True)

def _perf_read(filename: str, since_s: float = 0.0) -> list[dict[str, Any]]:
    path = _perf_root() / filename
    if not path.exists():
        return []
    out: list[dict[str, Any]] = []
    try:
        with path.open("r") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    rec = json.loads(line)
                except Exception:
                    continue
                if since_s and rec.get("ts", 0) < since_s:
                    continue
                out.append(rec)
    except Exception:
        log.debug("web-chat: perf log read failed", exc_info=True)
    return out

def _percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * (pct / 100.0)
    f, c = int(k), min(int(k) + 1, len(s) - 1)
    if f == c:
        return s[f]
    return s[f] + (s[c] - s[f]) * (k - f)

def _perf_stats(values: list[float]) -> dict[str, Any]:
    return {
        "count": len(values),
        "p50_ms": round(_percentile(values, 50), 1),
        "p95_ms": round(_percentile(values, 95), 1),
        "max_ms": round(max(values), 1) if values else 0.0,
    }

def _valid_session_id(session_id: str) -> bool:
    return bool(session_id and _SESSION_RE.match(session_id) and ".." not in session_id and "/" not in session_id and "\\" not in session_id)

def _new_session_id() -> str:
    return str(uuid.uuid4())

def _safe_session_id(session_id: Optional[str]) -> str:
    if not session_id:
        return _new_session_id()
    if not _valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="invalid session_id")
    return session_id

def _sanitize_filename(name: str) -> str:
    base = Path(name or "upload.bin").name
    base = re.sub(r"[^A-Za-z0-9._ -]", "_", base).strip(" .")
    return base[:160] or "upload.bin"

def _file_type(path_or_name: str, content_type: str | None = None) -> str:
    ext = Path(path_or_name).suffix.lower()
    for typ, exts in _ALLOWED_EXTS.items():
        if ext in exts:
            return typ
    if content_type:
        if content_type.startswith("image/"): return "image"
        if content_type.startswith("audio/"): return "audio"
        if content_type.startswith("video/"): return "video"
        if content_type == "application/pdf": return "pdf"
    return "file"

def _unique_path(directory: Path, filename: str) -> Path:
    target = directory / filename
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    for i in range(1, 10000):
        cand = directory / f"{stem}-{i}{suffix}"
        if not cand.exists():
            return cand
    raise HTTPException(status_code=409, detail="could not allocate unique filename")

def _is_inside(path: Path, parent: Path) -> bool:
    try:
        path.resolve().relative_to(parent.resolve())
        return True
    except Exception:
        return False

def _path_allowed(path_s: str) -> Optional[Path]:
    try:
        p = Path(path_s).expanduser().resolve()
    except Exception:
        return None
    root = _root().resolve()
    return p if _is_inside(p, root) else None

def _derive_title(messages: list[dict[str, Any]]) -> str:
    for m in messages:
        if m.get("role") == "user":
            text = str(m.get("text") or m.get("content") or "").strip().replace("\n", " ")
            if text:
                return text[:60]
    return "New chat"

def _open_db(profile: Optional[str] = None, read_only: bool = False) -> Any:
    """Open the profile's real session store (state.db) — the same store the
    dashboard, desktop, and gateway use. None/empty profile = this process's own."""
    from hermes_cli.web_server_sessions import _open_session_db_for_profile
    return _open_session_db_for_profile(profile, read_only=read_only)

def _session_source(session_id: str) -> Optional[str]:
    """Resolve a session id and return its source, or None if it doesn't exist."""
    db = _open_db(read_only=True)
    try:
        sid = db.resolve_session_id(session_id)
        if not sid:
            return None
        s = db.get_session(sid)
        return (s or {}).get("source")
    finally:
        db.close()

def _load_session_messages(session_id: str, profile: Optional[str] = None) -> list[dict[str, Any]]:
    """Read a real session's messages from state.db, mapped to the UI shape.

    Only web-chat's own sessions are readable — a desktop/gateway session id
    (e.g. a stale localStorage value from before the source filter existed)
    must never surface here. ``profile`` scopes to a non-default profile's own
    state.db (matches the dashboard's management-profile switcher selection).
    """
    db = _open_db(profile, read_only=True)
    try:
        sid = db.resolve_session_id(session_id)
        if not sid:
            return []
        s = db.get_session(sid)
        if not s:
            return []
        rows = db.get_messages(sid, limit=500, latest=True)
        out = []
        for m in rows:
            role = m.get("role")
            if role not in ("user", "assistant"):
                continue
            content = m.get("content") or m.get("text") or ""
            if isinstance(content, list):
                content = "\n".join(str(p.get("text", "")) for p in content if isinstance(p, dict))
            content = str(content).strip()
            # Tool-call-only assistant turns (finish_reason="tool_calls") have
            # empty `content` — the desktop hides them; skip so they don't
            # render as empty bubbles.
            if not content:
                continue
            out.append({
                "id": m.get("id"),
                "role": role,
                "text": content,
                "content": content,
                "timestamp": m.get("timestamp") or m.get("created_at") or time.time(),
            })
        return out
    finally:
        db.close()

def _list_sessions(profile: Optional[str] = None) -> list[dict[str, Any]]:
    """List sessions the dashboard's "Chats" category would show: every source
    EXCEPT the automation set (cron/tool/api_server/acp/hermes_flow/
    vulcan_delegate/webhook) — mirrors web/src/pages/SessionsPage.tsx
    AUTOMATION_SESSION_SOURCES so this list matches the dashboard 1:1.
    ``profile`` scopes to the dashboard's currently-selected management
    profile instead of this plugin process's own profile."""
    db = _open_db(profile, read_only=True)
    try:
        rows = db.list_sessions_rich(
            limit=50, order_by_last_active=True, compact_rows=True, include_pinned=True,
            exclude_sources=_AUTOMATION_SESSION_SOURCES)
        out = []
        for s in rows:
            sid = s.get("id") or s.get("session_id")
            out.append({
                "session_id": sid,
                "title": s.get("title") or s.get("display_title") or "New chat",
                "preview": (s.get("preview") or "")[:120],
                "created_at": s.get("created_at"),
                "updated_at": s.get("last_active") or s.get("updated_at"),
                "message_count": s.get("message_count") or 0,
                "source": s.get("source") or "",
                "model": s.get("model") or "",
                "is_busy": _session_busy(sid) if sid else False,
            })
        return out
    finally:
        db.close()

def _tool_label(tool_name: str) -> str:
    if tool_name in _TOOL_STATUS_MAP: return _TOOL_STATUS_MAP[tool_name]
    for prefix, label in (("browser_", "browsing"), ("web_", "searching"), ("terminal", "running"), ("process", "running"), ("write_", "writing"), ("patch", "writing"), ("read_", "reading"), ("search_", "reading")):
        if tool_name.startswith(prefix): return label
    return "working"


def _ws_send_safe(ws: Optional[WebSocket], payload: dict[str, Any], loop: Optional[asyncio.AbstractEventLoop] = None) -> None:
    """Send a frame on the event loop from an agent thread.

    ``loop`` MUST be the main-thread event loop captured in the WS handler.
    Python 3.13's ``asyncio.get_event_loop()`` raises RuntimeError when called
    from a non-main thread, so we never re-fetch it here — the clarify frame
    would otherwise be silently dropped and the card never reach the browser.
    """
    if ws is None:
        return
    try:
        if loop is None:
            loop = asyncio.get_event_loop()
        fut = asyncio.run_coroutine_threadsafe(
            ws.send_text(json.dumps(payload, ensure_ascii=False)), loop)
        fut.result(timeout=2)
    except Exception:
        log.debug("ws send failed (stream closed?)", exc_info=True)


def _clarify_block_in_thread(
    session_id: str,
    question: str,
    choices: Optional[list[str]],
    multi_select: bool,
    questions: Optional[list[dict[str, Any]]] = None,
    loop: Optional[asyncio.AbstractEventLoop] = None,
) -> str:
    """Runs inside the agent thread (blocking). Sends a clarify card frame to the
    browser over the session's plugin WS and blocks until the user answers
    (POST /clarify), then returns the raw answer for clarify_tool to parse.
    On timeout / stream loss returns the tool's "user walked away" sentinel.
    """
    # The clarify tool passes decorated choices (with " (Recommended)") to the
    # callback only in the single-question path; send the display text verbatim
    # so the card doesn't double-decorate. The batch path passes normalized
    # entries that ALREADY carry decorated choices (+ bare choices_offered).
    rid = uuid.uuid4().hex
    pending: dict[str, Any] = {
        "ws": None, "answers": {}, "done": threading.Event(), "timed_out": False,
        "session_id": session_id, "payload": None,
    }
    if questions:
        pending["expected_qids"] = [q.get("qid") for q in questions]
    _pending_clarify[rid] = pending
    with _CLARIFY_WS_LOCK:
        ws = _ws_by_session.get(session_id)
    pending["ws"] = ws
    try:
        if questions:
            payload = {
                "type": "clarify", "request_id": rid, "questions": questions,
            }
        else:
            payload = {
                "type": "clarify", "request_id": rid, "question": question,
                "choices": choices, "multi_select": bool(multi_select),
            }
        pending["payload"] = payload
        _ws_send_safe(ws, payload, loop)
        if not pending["done"].wait(_CLARIFY_TIMEOUT):
            pending["timed_out"] = True
            try:
                _ws_send_safe(ws, {"type": "clarify.expire", "request_id": rid}, loop)
            except Exception:
                pass
            return (
                "The user did not provide a response within the time limit. "
                "Re-ask with a more specific question or proceed with your best judgement "
                "and clearly note the assumption."
            )
        answers = pending["answers"]
        if questions:
            return json.dumps({"answers": answers}, ensure_ascii=False)
        return answers.get("qanswer", "")
    finally:
        _pending_clarify.pop(rid, None)


def _session_lock(session_id: str) -> asyncio.Lock:
    lock = _session_locks.get(session_id)
    if lock is None:
        lock = asyncio.Lock()
        _session_locks[session_id] = lock
    return lock


def _register_ws(session_id: str, ws: WebSocket) -> None:
    """Track the WS stream that owns a session's clarify round-trips."""
    with _CLARIFY_WS_LOCK:
        _ws_by_session[session_id] = ws


def _unregister_ws(session_id: str, ws: WebSocket) -> None:
    with _CLARIFY_WS_LOCK:
        if _ws_by_session.get(session_id) is ws:
            _ws_by_session.pop(session_id, None)


def _session_busy(session_id: str) -> bool:
    """True while a /stream WS owns this session's in-flight agent turn.

    Registered in _register_ws right after the WS handshake (before the
    per-session lock is acquired) and cleared in _unregister_ws after the
    turn's done/clear frames are sent -- so this spans exactly the window a
    client should treat the session as busy, regardless of which browser
    tab/device/reload initiated it. Lets a freshly-loaded or refreshed page
    (whose busyMap always starts empty client-side) recover the true state
    instead of silently queuing a second turn behind the per-session lock --
    a send while genuinely busy does NOT interrupt the active turn, it queues
    invisibly until the lock frees, which looks hung with no feedback."""
    with _CLARIFY_WS_LOCK:
        return session_id in _ws_by_session


def _agent_history_from_chat_upload(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Convert UI session messages into OpenAI-style AIAgent history."""
    out: list[dict[str, Any]] = []
    for msg in messages or []:
        role = msg.get("role")
        if role not in {"user", "assistant"}:
            continue
        content = msg.get("content", msg.get("text", ""))
        if isinstance(content, list):
            content = "\n".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
        content = str(content or "").strip()
        if content:
            out.append({"role": role, "content": content})
    return out


def _refresh_agent_callbacks(agent: Any, callbacks: dict[str, Callable | None]) -> None:
    for attr, cb in callbacks.items():
        if hasattr(agent, attr):
            setattr(agent, attr, cb)


def _get_active_agent(session_id: str, profile: Optional[str], agent_factory: Callable[..., Any], *, history: list[dict[str, Any]], callbacks: dict[str, Callable | None], model: str = "") -> Any:
    agent = _active_agents.get(session_id)
    # Recreate when the profile OR the per-session model changed — a session's
    # model is scoped to that chat, so switching it must take effect next turn.
    if agent is not None and (
        _active_agent_profiles.get(session_id) != profile
        or (model and _active_agent_models.get(session_id) != model)
    ):
        _active_agents.pop(session_id, None)
        _active_agent_profiles.pop(session_id, None)
        _active_agent_models.pop(session_id, None)
        old_db = _active_agent_dbs.pop(session_id, None)
        if old_db is not None:
            try: old_db.close()
            except Exception: pass
        agent = None
    if agent is None:
        # Give the agent the REAL session store so its chats persist to state.db
        # with source "dashboard-plugin:web-chat" — never the desktop's rows.
        db = _open_db(read_only=False)
        agent = agent_factory(
            session_id=session_id,
            platform="dashboard-plugin:web-chat",
            session_db=db,
            tool_start_callback=callbacks.get("tool_start_callback"),
            tool_complete_callback=callbacks.get("tool_complete_callback"),
            stream_delta_callback=callbacks.get("stream_delta_callback"),
            clarify_callback=callbacks.get("clarify_callback"),
            quiet_mode=True,
        )
        _active_agent_dbs[session_id] = db
        if history and not getattr(agent, "_session_messages", None):
            agent._session_messages = list(history)
        _active_agents[session_id] = agent
        _active_agent_profiles[session_id] = profile
        _active_agent_models[session_id] = model
    else:
        _active_agents.move_to_end(session_id)
        _refresh_agent_callbacks(agent, callbacks)
    while len(_active_agents) > max(1, _ACTIVE_AGENT_MAX):
        old_sid, old_agent = _active_agents.popitem(last=False)
        _active_agent_profiles.pop(old_sid, None)
        _active_agent_models.pop(old_sid, None)
        old_db = _active_agent_dbs.pop(old_sid, None)
        if old_db is not None:
            try: old_db.close()
            except Exception: pass
        close = getattr(old_agent, "close", None)
        if callable(close):
            try:
                close()
            except Exception:
                pass
    return agent


def _run_agent_turn(agent: Any, user_text: str) -> str:
    conversation_history = list(getattr(agent, "_session_messages", []) or [])
    if hasattr(agent, "run_conversation"):
        result = agent.run_conversation(user_text, conversation_history=conversation_history)
        if isinstance(result, dict):
            return str(result.get("final_response") or "")
        return str(result or "")
    return str(agent.chat(user_text) or "")

def _check_ws_token(provided: Optional[str], ws: WebSocket | None = None) -> bool:
    # Dashboard commonly runs --insecure; allow loopback/no-token in local test/dev.
    if ws is not None:
        host = getattr(ws.client, "host", "") if ws.client else ""
        if host in {"127.0.0.1", "::1", "localhost"}: return True
    # Gated mode (OAuth): the SPA token is NOT injected, so the browser's WS
    # handshake carries the OAuth session cookie instead. Verify it with the
    # dashboard's own provider stack — same path the REST gate uses.
    try:
        from hermes_cli import web_server as _ws
        if getattr(_ws.app.state, "auth_required", False):
            from hermes_cli.dashboard_auth.cookies import read_session_cookies
            from hermes_cli.dashboard_auth.request_utils import scan_session_providers
            at, _rt = read_session_cookies(ws)
            if at:
                try:
                    session = scan_session_providers(
                        None, lambda p: p.verify_session(access_token=at),
                        phase="plugin ws verify", log=log)
                    return session is not None
                except Exception:
                    return False
            return False
        expected = getattr(_ws, "_SESSION_TOKEN", None)
    except Exception:
        expected = None
    if not expected: return True
    return bool(provided) and hmac.compare_digest(str(provided), str(expected))

def _cleanup_old_uploads() -> None:
    global _LAST_CLEANUP
    now = time.time()
    if now - _LAST_CLEANUP < 86400: return
    _LAST_CLEANUP = now
    try:
        days = int(os.getenv("HERMES_UPLOAD_RETENTION_DAYS", "30"))
        cutoff = now - days * 86400
        for child in _uploads_root().iterdir():
            try:
                if child.stat().st_mtime < cutoff:
                    shutil.rmtree(child) if child.is_dir() else child.unlink()
            except Exception:
                pass
    except Exception:
        log.exception("upload cleanup failed")

class ChatSession:
    def __init__(self, ws_id: str, session_id: str, profile: Optional[str] = None):
        self.ws_id = ws_id; self.session_id = session_id; self.profile = profile; self.history: list[dict[str, Any]] = []
    def load_history(self, history: list[dict[str, Any]]) -> None:
        self.history = history or []
    def get_displayable_history(self) -> list[dict[str, str]]:
        out = []
        for m in self.history:
            if m.get("role") not in {"user", "assistant"}: continue
            content = m.get("text", m.get("content", ""))
            if isinstance(content, list):
                content = "\n".join(str(part.get("text", "")) for part in content if isinstance(part, dict))
            content = str(content).strip()
            if content: out.append({"role": m.get("role"), "content": content})
        return out

@router.get("/health")
async def health():
    return {"plugin": "web-chat", "version": PLUGIN_VERSION, "ok": True}

@router.get("/profiles")
async def profiles():
    prof_root = Path(get_hermes_home()).expanduser() / "profiles"
    names = []
    if prof_root.exists():
        names = sorted([p.name for p in prof_root.iterdir() if p.is_dir()])
    return {"profiles": names, "default": os.getenv("HERMES_PROFILE") or "default"}

@router.get("/sessions")
async def sessions_list(profile: Optional[str] = Query(None)):
    if _USE_SERVE_BACKEND:
        return {"sessions": await _list_sessions_via_serve(profile)}
    return {"sessions": _list_sessions(profile)}

@router.post("/sessions")
async def sessions_create(req: SessionSaveRequest):
    sid = _new_session_id()
    return {"session_id": sid, "messages": req.messages, "title": req.title or "New chat"}

@router.get("/sessions/{session_id}")
async def sessions_get(session_id: str, profile: Optional[str] = Query(None)):
    if not _valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="invalid session_id")
    if _USE_SERVE_BACKEND:
        served = await _load_session_via_serve(session_id, profile)
        if not served["messages"]:
            raise HTTPException(status_code=404, detail="session not found")
        return {"session_id": session_id, "messages": served["messages"],
                "history": served["messages"], "model": served["model"],
                "is_busy": served["is_busy"]}
    messages = _load_session_messages(session_id, profile)
    if not messages:
        raise HTTPException(status_code=404, detail="session not found")
    model = ""
    db = _open_db(profile, read_only=True)
    try:
        sid = db.resolve_session_id(session_id)
        if sid:
            s = db.get_session(sid)
            model = (s or {}).get("model") or ""
    finally:
        db.close()
    return {"session_id": session_id, "messages": messages, "history": messages, "model": model, "is_busy": _session_busy(session_id)}

@router.put("/sessions/{session_id}")
async def sessions_put(session_id: str, req: SessionSaveRequest):
    # The agent persists to state.db itself; this endpoint is a no-op kept for
    # frontend compatibility (optimistic saves).
    return {"ok": True, "session_id": session_id}

@router.post("/sessions/{session_id}/model")
async def sessions_set_model(session_id: str, req: SessionModelRequest, profile: Optional[str] = Query(None)):
    if _USE_SERVE_BACKEND:
        if not _valid_session_id(session_id):
            raise HTTPException(status_code=400, detail="invalid session_id")
        return await _set_model_via_serve(session_id, req.model, profile)
    """Persist the per-session model to the session row so the dashboard and
    web-chat read the SAME source of truth (no more client-side drift)."""
    if not _valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="invalid session_id")
    model = (req.model or "").strip()
    if not model:
        raise HTTPException(status_code=400, detail="model is required")
    db = _open_db(profile, read_only=False)
    try:
        sid = db.resolve_session_id(session_id)
        if not sid:
            raise HTTPException(status_code=404, detail="session not found")
        db.update_session_model(sid, model)
    finally:
        db.close()
    return {"ok": True, "session_id": session_id, "model": model}


async def _set_model_via_serve(session_id: str, model: str, profile: Optional[str] = None) -> dict[str, Any]:
    """`config.set` key=model, session-scoped. The gateway persists the per-session
    override itself (sessions.model), so no direct DB write -- and unlike the DB path
    it applies to a LIVE session's next turn even when that turn is being driven from
    another surface."""
    client = _serve_client(profile)
    # `config.set model` resolves `session_id` against the gateway's LIVE _sessions
    # map, not the store: an idle stored session answers 4001 "requires a live
    # session". Resume first (registers it + returns the RUNTIME id the setter
    # expects), then set. Verified live -- passing the stored id straight through
    # fails for exactly the case web-chat needs (pick a model on an idle chat).
    resumed = await client.rpc(
        "session.resume", {"session_id": session_id, "omit_messages": True})
    runtime_sid = str(resumed.get("session_id") or session_id)
    r = await client.rpc(
        "config.set", {"key": "model", "value": model, "session_id": runtime_sid})
    out: dict[str, Any] = {"ok": True, "session_id": session_id, "model": r.get("value") or model}
    # The setter can refuse pending confirmation (expensive model) -- surface that
    # instead of reporting a success that did not happen.
    for key in ("warning", "confirm_required", "confirm_message", "scope", "deferred"):
        if r.get(key) is not None:
            out[key] = r[key]
    if r.get("confirm_required"):
        out["ok"] = False
    return out

def _evict_active_agent(session_id: str) -> None:
    """Drop any cached in-process agent for a session so the next turn rebuilds
    it from state.db. Agents cache `_session_messages` at creation and never
    re-sync from the DB (see `_get_active_agent`) -- after a rewind (edit +
    resend) the cached copy still has the pre-rewind tail, so the very next
    turn would silently resurrect the "edited away" messages into the model's
    context even though the UI shows them gone. Eviction is the fix, not a
    _session_messages patch, because the agent may also hold other per-turn
    state (tool call ids, etc.) tied to the stale transcript."""
    agent = _active_agents.pop(session_id, None)
    _active_agent_profiles.pop(session_id, None)
    _active_agent_models.pop(session_id, None)
    old_db = _active_agent_dbs.pop(session_id, None)
    if old_db is not None:
        try: old_db.close()
        except Exception: pass
    if agent is not None:
        close = getattr(agent, "close", None)
        if callable(close):
            try: close()
            except Exception: pass


@router.post("/sessions/{session_id}/rewind")
async def sessions_rewind(session_id: str, req: RewindRequest, profile: Optional[str] = Query(None)):
    """Rewind (soft-delete) a user message and everything after it -- the
    edit-and-resend workflow. The caller re-sends the edited text as a normal
    new message afterward; this endpoint only truncates the transcript."""
    if not _valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="invalid session_id")
    if _USE_SERVE_BACKEND:
        # Defer: the cut is applied atomically by the next prompt.submit. Returning
        # ok=True here keeps the frontend's existing two-step flow (rewind, then
        # resend) working with no UI change.
        _pending_truncate[session_id] = int(req.message_id)
        return {"ok": True, "session_id": session_id, "rewound_count": 0, "deferred": True}
    db = _open_db(profile, read_only=False)
    try:
        sid = db.resolve_session_id(session_id)
        if not sid:
            raise HTTPException(status_code=404, detail="session not found")
        try:
            result = db.rewind_to_message(sid, req.message_id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc))
    finally:
        db.close()
    _evict_active_agent(session_id)
    return {"ok": True, "session_id": session_id, "rewound_count": result.get("rewound_count", 0)}


@router.post("/perf/client")
async def perf_client(req: ClientPerfRequest):
    """Frontend perf beacon: pre-aggregated (client-side) typing-latency stats,
    NOT one call per keystroke -- see PERF_PROFILER.md. Folded into
    perf/client.jsonl alongside perf/turns.jsonl (backend turn timing)."""
    _perf_append("client.jsonl", {
        "event": req.event, "p50_ms": req.p50_ms, "p95_ms": req.p95_ms,
        "max_ms": req.max_ms, "count": req.count, "message_count": req.message_count,
    })
    return {"ok": True}


@router.get("/perf/summary")
async def perf_summary(hours: float = Query(24.0)):
    """Rolled-up perf view for the cron watchdog (and for manual eyeballing).

    Backend turn latency (perf/turns.jsonl) is INFORMATIONAL ONLY -- it swings
    with whatever the agent is doing that turn (a browser task and a one-line
    reply are not comparable), so it is not a UI regression signal and the
    watchdog does not gate on it. The three frontend beacons (keystroke,
    longtask, session_switch -- perf/client.jsonl) are the actual "does the
    UI feel slow" signal and drive the watchdog's thresholds.

    Windowed by `hours` so a stale spike from days ago doesn't skew the read.
    """
    since = time.time() - max(hours, 0.01) * 3600.0
    turns = _perf_read("turns.jsonl", since_s=since)
    client = _perf_read("client.jsonl", since_s=since)
    total_ms = [t["total_ms"] for t in turns if isinstance(t.get("total_ms"), (int, float))]
    first_delta_ms = [t["first_delta_ms"] for t in turns if isinstance(t.get("first_delta_ms"), (int, float))]
    failures = [t for t in turns if not t.get("ok", True)]

    def client_stats(event: str) -> dict[str, Any]:
        vals = [c["p95_ms"] for c in client if c.get("event") == event and c.get("p95_ms")]
        return _perf_stats(vals)

    return {
        "window_hours": hours,
        "turn_count": len(turns),
        "turn_total_ms_informational": _perf_stats(total_ms),
        "turn_first_delta_ms_informational": _perf_stats(first_delta_ms),
        "failure_count": len(failures),
        "client_keystroke_p95_ms": client_stats("keystroke"),
        "client_longtask_p95_ms": client_stats("longtask"),
        "client_session_switch_p95_ms": client_stats("session_switch"),
        "sample_failures": [
            {"session_id": t.get("session_id"), "total_ms": t.get("total_ms")}
            for t in failures[-5:]
        ],
    }


@router.delete("/sessions/{session_id}")
async def sessions_delete(session_id: str, profile: Optional[str] = Query(None)):
    if not _valid_session_id(session_id): raise HTTPException(status_code=400, detail="invalid session_id")
    if _USE_SERVE_BACKEND:
        client = _serve_client(profile)
        # `session.delete` refuses ANY session the gateway still holds in _sessions
        # -- which includes a merely-RESUMED (open, idle) chat, not just a running
        # turn. Simply opening a chat in web-chat would make it undeletable. So:
        # refuse only a genuinely RUNNING turn, otherwise release the gateway's
        # claim with session.close first, then delete.
        try:
            live = await client.rpc(
                "session.resume", {"session_id": session_id, "omit_messages": True})
        except Exception:
            live = {}
        if live.get("running"):
            raise HTTPException(
                status_code=409, detail="cannot delete a session while its turn is running")
        runtime_sid = str(live.get("session_id") or "")
        if runtime_sid:
            with contextlib.suppress(Exception):
                await client.rpc("session.close", {"session_id": runtime_sid})
        try:
            await client.rpc("session.delete", {"session_id": session_id})
        except RuntimeError as exc:
            detail = str(exc)
            if "4023" in detail or "active session" in detail:
                raise HTTPException(status_code=409, detail="cannot delete a session that is currently running")
            if "4007" not in detail and "not found" not in detail:
                raise HTTPException(status_code=502, detail=detail)
        up = _uploads_root() / session_id
        if up.exists() and _is_inside(up, _uploads_root()):
            shutil.rmtree(up)
        return {"ok": True}
    db = _open_db(profile, read_only=False)
    try:
        sid = db.resolve_session_id(session_id)
        if sid:
            db.delete_session(sid)
    finally:
        db.close()
    up = _uploads_root() / session_id
    if up.exists() and _is_inside(up, _uploads_root()): shutil.rmtree(up)
    return {"ok": True}

@router.post("/upload")
async def upload(file: UploadFile = File(...), session_id: str = Form(...)):
    _cleanup_old_uploads()
    sid = _safe_session_id(session_id)
    raw = await file.read()
    if len(raw) > _MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="file too large")
    filename = _sanitize_filename(file.filename or "upload.bin")
    typ = _file_type(filename, file.content_type)
    dest_dir = _uploads_root() / sid
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest = _unique_path(dest_dir, filename)
    dest.write_bytes(raw)
    warning = None
    if dest.suffix.lower() in _EXECUTABLE_EXTS:
        warning = "Potentially executable file uploaded; inspect before running."
    return {"ok": True, "session_id": sid, "filename": dest.name, "original_filename": file.filename, "path": str(dest), "url": f"/api/plugins/web-chat/file?path={dest}", "type": typ, "content_type": file.content_type, "size": len(raw), "warning": warning}

async def _serve_open_clarify(session_id: str, profile: Optional[str] = None) -> Optional[dict[str, Any]]:
    """`session.resume(omit_messages)` -> the session's open clarify request, if any.
    Reads `open_requests`, the gateway's own reconnect-snapshot surface, so a question
    raised in ANY process (desktop/TUI included) is visible here."""
    try:
        r = await _serve_client(profile).rpc(
            "session.resume", {"session_id": session_id, "omit_messages": True})
    except Exception:
        return None
    for req in (r.get("open_requests") or []):
        if req.get("method") == "clarify":
            return {"request_id": str(req.get("id") or ""), "params": req.get("params") or {},
                    "session_key": str(r.get("session_key") or session_id),
                    "client": _serve_client(profile)}
    return None


async def _serve_pending_clarify_for(session_id: str, profile: Optional[str] = None) -> Optional[dict[str, Any]]:
    """The exact WS frame shape the browser's ClarifyCard expects, or None."""
    found = await _serve_open_clarify(session_id, profile)
    if not found:
        return None
    rid, params = found["request_id"], found["params"]
    _serve_clarify_pending.setdefault(rid, {
        "session_id": found["session_key"], "client": found["client"], "params": params,
        "answers": dict(params.get("answers") or {})})
    frame: dict[str, Any] = {"type": "clarify", "request_id": rid}
    if params.get("questions"):
        frame["questions"] = params["questions"]
    else:
        frame["question"] = params.get("question") or ""
        frame["choices"] = params.get("choices") or []
    return frame


async def _serve_pending_clarify_sessions() -> list[str]:
    """Session ids currently blocked on a clarify, across the listed sessions.
    Bounded to the visible list so this stays a cheap poll."""
    try:
        rows = await _list_sessions_via_serve(None)
    except Exception:
        return []
    sids = [r["session_id"] for r in rows if r.get("session_id")][:_CLARIFY_SCAN_LIMIT]
    if not sids:
        return []
    # Sequential probing cost ~2s for 15 sessions -- far too slow for a polled
    # badge endpoint. Fan out instead: one resume per session, concurrently.
    results = await asyncio.gather(
        *(_serve_open_clarify(sid) for sid in sids), return_exceptions=True)
    return [sid for sid, found in zip(sids, results)
            if found and not isinstance(found, BaseException)]


@router.get("/pending_clarify_sessions")
async def pending_clarify_sessions():
    """All session_ids across every profile with an unanswered clarify card right
    now -- powers the sidebar badge so a pending question in a BACKGROUND chat is
    visible without having to open that chat (see pending_clarify below, which is
    the single-session recovery poll this complements)."""
    ids = {
        p["session_id"] for p in _pending_clarify.values()
        if p.get("payload") and not p["done"].is_set()
    }
    if _USE_SERVE_BACKEND:
        # Serve-backed cards: ask the gateway which sessions are blocked on a
        # question RIGHT NOW -- including turns driven by desktop/TUI, which the
        # in-process _pending_clarify map can never see.
        ids |= set(await _serve_pending_clarify_sessions())
    return {"session_ids": sorted(ids)}


@router.get("/pending_clarify")
async def pending_clarify(session_id: str):
    """Recovery endpoint: a reconnected/reloaded client for this session polls this
    to find a clarify question that is blocking the agent thread but whose original
    delivery (over a since-dropped WS) never reached the browser. Returns the exact
    frame shape the WS would have sent, so the frontend can setClarify() it directly."""
    if not _valid_session_id(session_id):
        raise HTTPException(status_code=400, detail="invalid session_id")
    for rid, pending in list(_pending_clarify.items()):
        if pending.get("session_id") == session_id and pending.get("payload") and not pending["done"].is_set():
            return {"pending": True, "request_id": rid, "frame": pending["payload"]}
    if _USE_SERVE_BACKEND:
        frame = await _serve_pending_clarify_for(session_id)
        if frame:
            return {"pending": True, "request_id": frame["request_id"], "frame": frame}
    return {"pending": False}


@router.post("/clarify")
async def clarify_answer(req: ClarifyAnswerRequest):
    """Answer an in-flight clarify card (virgil-style round trip). The agent
    thread blocked in _clarify_block_in_thread unblocks with the answer."""
    rid = req.request_id
    served = _serve_clarify_pending.get(rid)
    if served is not None:
        # Serve-backend card: answer the gateway's server request directly. The
        # gateway ALWAYS uses the batch shape (questions[]/qid), so answers are
        # keyed by qid -- a bare {"answer": ...} reads as empty/skip.
        params = served.get("params") or {}
        qs = params.get("questions") or []
        answers = served.setdefault("answers", {})
        qid = req.question_id or (qs[0]["qid"] if qs else "q0")
        answers[qid] = req.answer or ""
        expected = [q.get("qid") for q in qs] or [qid]
        remaining = [q for q in expected if q not in answers]
        if not remaining:
            await served["client"].respond_to_request(rid, {"answers": dict(answers)})
            _serve_clarify_pending.pop(rid, None)
        return {"ok": True, "request_id": rid, "remaining": remaining}
    pending = _pending_clarify.get(rid)
    if not pending:
        raise HTTPException(status_code=404, detail="no pending clarify for this request id (expired?)")
    expected = pending.get("expected_qids")
    if expected:
        # Batch shape: key answers by qid; done once every expected qid is in.
        if req.question_id:
            pending["answers"][req.question_id] = req.answer or ""
        if all(q in pending["answers"] for q in expected):
            pending["done"].set()
    else:
        # Single-question path: the frontend synthesizes qid "q0" and sends it
        # as question_id, but _clarify_block_in_thread reads the answer back
        # under "qanswer". Store there so the answer is not lost.
        pending["answers"]["qanswer"] = req.answer or ""
        pending["done"].set()
    return {"ok": True, "request_id": rid}


@router.get("/resolve")
async def resolve(path: str):
    p = _path_allowed(path)
    if not p or not p.exists() or not p.is_file():
        return {"exists": False, "path": path}
    return {"exists": True, "path": str(p), "filename": p.name, "type": _file_type(p.name), "size": p.stat().st_size, "url": f"/api/plugins/web-chat/file?path={p}"}

@router.get("/file")
async def serve_file(path: str, inline: bool = False):
    p = _path_allowed(path)
    if not p or not p.exists() or not p.is_file():
        raise HTTPException(status_code=403, detail="file not allowed")
    media_type = mimetypes.guess_type(str(p))[0] or "application/octet-stream"
    disposition = "inline" if inline else "attachment"
    return FileResponse(str(p), media_type=media_type, filename=p.name, headers={"Content-Disposition": f'{disposition}; filename="{p.name}"'})

@router.post("/bulk-download")
async def bulk_download(req: BulkRequest):
    if len(req.paths) > _MAX_BULK_FILES: raise HTTPException(status_code=400, detail="too many files")
    buf = io.BytesIO()
    count = 0
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as zf:
        for path_s in req.paths:
            p = _path_allowed(path_s)
            if p and p.exists() and p.is_file():
                zf.write(p, arcname=p.name); count += 1
    if count == 0: raise HTTPException(status_code=404, detail="no valid files")
    return Response(buf.getvalue(), media_type="application/zip", headers={"Content-Disposition": 'attachment; filename="web-chat-files.zip"'})

@router.delete("/uploads/{session_id}")
async def clear_uploads(session_id: str):
    if not _valid_session_id(session_id): raise HTTPException(status_code=400, detail="invalid session_id")
    up = _uploads_root() / session_id
    if up.exists() and _is_inside(up, _uploads_root()): shutil.rmtree(up)
    return {"ok": True}

@router.post("/stop")
async def stop(req: StopRequest):
    """Interrupt the in-flight agent turn for a session (hard cancel)."""
    agent = _active_agents.get(req.session_id)
    if agent is None:
        return {"ok": False, "reason": "no active agent"}
    try:
        interrupt = getattr(agent, "interrupt", None)
        if not callable(interrupt):
            return {"ok": False, "reason": "agent has no interrupt()"}
        interrupt(hard_cancel=True)
        return {"ok": True}
    except Exception as exc:
        log.exception("web-chat stop failed")
        return {"ok": False, "reason": str(exc)}


async def _stream_via_serve(ws: WebSocket, msg: dict[str, Any]) -> None:
    """Drive one turn through `hermes serve` instead of an in-process AIAgent.

    This is the fix for the whole investigation: the turn runs inside the SAME
    per-profile serve daemon the desktop/TUI use, so clarify/approval prompts and
    busy state are visible across surfaces instead of being trapped in whichever
    process happened to start the turn.

    Frame contract to the browser is UNCHANGED (session/status/delta/clarify/
    clarify.expire/done/clear/error) so `src/index.jsx` needs no edits.
    """
    user_text = str(msg["text"])
    profile = msg.get("profile")
    client_sid = _safe_session_id(msg.get("session_id"))
    model = msg.get("model") or ""
    client = _serve_client(profile)
    loop = asyncio.get_event_loop()
    q: asyncio.Queue = asyncio.Queue()

    def _push(frame: dict[str, Any]) -> None:
        # Handlers fire on the client's recv task (same loop) -- put_nowait is safe
        # and avoids the cross-thread round trip the in-process path needs.
        try:
            q.put_nowait(frame)
        except Exception:
            log.exception("web-chat: failed to enqueue relay frame")

    # ---- resolve the session on the serve side -------------------------------
    runtime_sid = ""
    stored_sid = client_sid
    _resume_result: dict[str, Any] = {}
    try:
        r = await client.rpc("session.resume", {"session_id": client_sid, "omit_messages": True})
        _resume_result = r
        runtime_sid = str(r.get("session_id") or "")
        stored_sid = str(r.get("session_key") or r.get("resumed") or client_sid)
    except Exception:
        # Unknown to hermes serve (fresh client-minted uuid): create it.
        created = await client.rpc(
            "session.create", {"title": "New chat", "source": _WEBCHAT_SOURCE})
        runtime_sid = str(created.get("session_id") or "")
        stored_sid = str(created.get("stored_session_id") or runtime_sid)
    if not runtime_sid:
        await ws.send_text(json.dumps({"type": "error", "text": "could not resolve session"}))
        return
    # Tell the browser the canonical id; its existing renameKey path migrates state.
    await ws.send_text(json.dumps({"type": "session", "session_id": stored_sid}))
    await ws.send_text(json.dumps({"type": "status", "label": "thinking"}))

    # ---- relay: gateway events -> existing browser frames ---------------------
    finished = asyncio.Event()

    def _replay_open_requests(resume_result: dict[str, Any]) -> None:
        """A clarify raised BEFORE we attached (e.g. the turn is running in the
        desktop/TUI process) never arrives as a live frame -- the gateway wrote it
        to whichever transport owned the session then. `session.resume` returns it
        in `open_requests` precisely so a late/reconnecting client can render it.
        Without this, a cross-surface clarify stays invisible: the exact bug this
        whole migration exists to fix."""
        for req in (resume_result.get("open_requests") or []):
            if req.get("method") != "clarify":
                continue
            rid, params = str(req.get("id") or ""), (req.get("params") or {})
            if not rid or rid in _serve_clarify_pending:
                continue
            frame = {"type": "clarify", "request_id": rid}
            if params.get("questions"):
                frame["questions"] = params["questions"]
            else:
                frame["question"] = params.get("question") or ""
                frame["choices"] = params.get("choices") or []
            _serve_clarify_pending[rid] = {
                "session_id": stored_sid, "client": client, "params": params,
                "answers": dict(params.get("answers") or {})}
            _push(frame)

    def _mine(sid: str) -> bool:
        # Cross-session stream leak guard (hermes-chat-frontend skill): only this
        # turn's session may write to this socket.
        return not sid or sid in (runtime_sid, stored_sid)

    def _on_event(etype: str, sid: str, payload: dict[str, Any]) -> None:
        if not _mine(sid):
            return
        if etype == "message.delta":
            text = payload.get("text") or ""
            if text:
                _push({"type": "status", "label": "responding"})
                _push({"type": "delta", "text": text})
        elif etype == "tool.start":
            name = str(payload.get("name") or payload.get("tool") or "")
            if name and not name.startswith("_"):
                _push({"type": "status", "label": _tool_label(name)})
        elif etype == "tool.complete":
            _push({"type": "status", "label": "thinking"})
        elif etype == "status.update":
            label = payload.get("text") or payload.get("kind") or ""
            if label:
                _push({"type": "status", "label": str(label)})
        elif etype == "message.complete":
            _push({"type": "done", "text": str(payload.get("text") or ""), "session_id": stored_sid})
            _push({"type": "clear"})
            loop.call_soon_threadsafe(finished.set)
        elif etype == "error":
            _push({"type": "error", "text": str(payload.get("text") or payload.get("message") or "agent error")})
            loop.call_soon_threadsafe(finished.set)
        elif etype == "request.cancel":
            # The gateway withdrew a pending clarify/approval (timeout, /approve all,
            # answered on another surface) -- clear the card instead of leaving it stuck.
            rid = str(payload.get("id") or "")
            if rid:
                _push({"type": "clarify.expire", "request_id": rid})

    def _on_request(request_id: str, method: str, sid: str, params: dict[str, Any]) -> None:
        if not _mine(sid):
            return
        if method != "clarify":
            # approval/sudo/etc: Task 6. Answering nothing would hang the agent, so
            # decline explicitly rather than silently blocking (the exact failure
            # mode this migration exists to eliminate).
            asyncio.run_coroutine_threadsafe(
                client.respond_to_request(request_id, {"choice": "deny"} if method == "approval" else {"value": ""}),
                loop)
            return
        # The gateway ALWAYS sends the batch shape (questions[] with qid), even for
        # a single question -- verified live. Forward it verbatim: the frontend's
        # ClarifyCard already consumes {questions:[{qid,question,choices,multi_select}]}.
        frame = {"type": "clarify", "request_id": request_id}
        if params.get("questions"):
            frame["questions"] = params["questions"]
        else:
            frame["question"] = params.get("question") or ""
            frame["choices"] = params.get("choices") or []
            frame["multi_select"] = bool(params.get("multi_select"))
        _serve_clarify_pending[request_id] = {
            "session_id": stored_sid, "client": client, "params": params}
        _push(frame)

    client.on_event(_on_event)
    client.on_server_request(_on_request)
    if _resume_result:
        _replay_open_requests(_resume_result)
    submit_params: dict[str, Any] = {"session_id": runtime_sid, "text": user_text}
    cut_row = _pending_truncate.pop(stored_sid, None) or _pending_truncate.pop(client_sid, None)
    if cut_row is not None:
        # Atomic rewind+resend: the ONLY mapping that also truncates the gateway's
        # live in-memory history (see _pending_truncate's note).
        submit_params["truncate_before_row_id"] = int(cut_row)
        submit_params["confirm_truncate"] = True
    try:
        await client.rpc("prompt.submit", submit_params)
        while True:
            try:
                frame = await asyncio.wait_for(q.get(), timeout=0.25)
            except asyncio.TimeoutError:
                if finished.is_set() and q.empty():
                    break
                continue
            await ws.send_text(json.dumps(frame))
    except WebSocketDisconnect:
        return
    finally:
        # Detach this turn's handlers so a long-lived client doesn't accumulate them.
        for lst, fn in ((client._event_handlers, _on_event), (client._request_handlers, _on_request)):
            try:
                lst.remove(fn)
            except ValueError:
                pass
        for rid, meta in list(_serve_clarify_pending.items()):
            if meta.get("session_id") == stored_sid:
                _serve_clarify_pending.pop(rid, None)


@router.websocket("/stream")
async def stream_ws(ws: WebSocket) -> None:
    token = ws.query_params.get("token", "")
    if not _check_ws_token(token, ws):
        await ws.close(code=4401); return
    await ws.accept()
    loop = asyncio.get_event_loop()
    try:
        raw = await asyncio.wait_for(ws.receive_text(), timeout=60)
        msg = json.loads(raw)
    except (asyncio.TimeoutError, json.JSONDecodeError, WebSocketDisconnect) as exc:
        await ws.send_text(json.dumps({"type": "error", "text": f"Bad handshake: {exc}"})); await ws.close(); return
    if msg.get("type") != "message" or not msg.get("text"):
        await ws.send_text(json.dumps({"type": "error", "text": "Expected {type:message, text:...}"})); await ws.close(); return
    if _USE_SERVE_BACKEND:
        try:
            await _stream_via_serve(ws, msg)
        except WebSocketDisconnect:
            pass
        except Exception as exc:
            log.exception("web-chat: serve-backend stream failed")
            with contextlib.suppress(Exception):
                await ws.send_text(json.dumps({"type": "error", "text": str(exc)}))
        finally:
            with contextlib.suppress(Exception):
                await ws.close()
        return
    user_text = str(msg["text"])
    session_id = _safe_session_id(msg.get("session_id"))
    # Cross-talk guard: a session id that resolves to a NON-web-chat row (e.g. a
    # stale localStorage value from before the source filter existed) must never
    # be written into. Mint a fresh web-chat session and tell the browser.
    src = _session_source(session_id)
    if src is None:
        session_id = _new_session_id()
    profile = msg.get("profile")
    attachments = msg.get("attachments") or []
    model = msg.get("model") or ""
    effort = msg.get("effort") or ""
    await ws.send_text(json.dumps({"type": "session", "session_id": session_id}))
    await ws.send_text(json.dumps({"type": "status", "label": "thinking"}))
    q: asyncio.Queue = asyncio.Queue(); result_holder: list[str] = []; error_holder: list[str] = []
    # Perf instrumentation: wall-clock markers for this turn, written to
    # perf/turns.jsonl on completion (see PERF_PROFILER.md). first_delta_at is
    # the biggest lever for "feels laggy" complaints -- everything before it
    # is dead air with no visible progress in the UI.
    _turn_t0 = time.monotonic()
    _first_delta_at: list[float] = []
    _tool_calls: list[str] = []
    def _push(frame: dict[str, Any]):
        fut = asyncio.run_coroutine_threadsafe(q.put(frame), loop)
        fut.result(timeout=1)
    def _on_tool_start(tool_call_id: str, name: str, args: dict):
        if tool_call_id and not name.startswith("_"):
            _tool_calls.append(name)
            _push({"type": "status", "label": _tool_label(name)})
    def _on_tool_complete(tool_call_id: str, name: str, args: dict, result):
        if tool_call_id and not name.startswith("_"): _push({"type": "status", "label": "thinking"})
    def _on_delta(delta: str):
        if not _first_delta_at: _first_delta_at.append(time.monotonic())
        _push({"type": "status", "label": "responding"}); _push({"type": "delta", "text": delta})
    def _on_clarify(question: str, choices=None, multi_select: bool = False, questions=None) -> str:
        # Runs on the agent thread; blocks until the browser answers the card
        # or the timeout fires. `questions` (batch shape) wins when non-empty.
        return _clarify_block_in_thread(
            session_id, question, choices, multi_select, questions=questions, loop=loop)

    _register_ws(session_id, ws)
    try:
        async with _session_lock(session_id):
            # History comes from the REAL store (state.db) — the same sessions the
            # dashboard/desktop/gateway see. The agent persists to it itself.
            history = _load_session_messages(session_id)
            agent_history = _agent_history_from_chat_upload(history)

            def _run_agent():
                try:
                    ha_path = str(Path(get_hermes_home()).expanduser() / "hermes-agent")
                    if ha_path not in sys.path: sys.path.insert(0, ha_path)
                    from run_agent import AIAgent
                    from hermes_cli.config import cfg_get, load_config
                    cfg = load_config()
                    default_model = cfg_get(cfg, "model", "default", default="")
                    default_provider = cfg_get(cfg, "model", "provider", default=None)
                    use_model = model or default_model
                    use_provider = default_provider
                    # The per-chat model picker lists models across EVERY configured provider
                    # (see /api/model/options), but the frontend sends back only a bare model
                    # id -- no provider. Blindly using the global default_provider here breaks
                    # every non-default-provider pick: e.g. selecting an anthropic model while
                    # the daily driver is ollama-cloud sent claude-sonnet-5 to ollama-cloud,
                    # which 404'd "model not found" on every retry with no visible chat
                    # response (the error only reached a log/status frame, not a message
                    # bubble -- the message appears sent but the agent never replies).
                    # Auto-detect the real provider for an explicitly-picked non-default
                    # model, same helper the TUI's /model command uses for this scenario.
                    if use_model and use_model != default_model:
                        try:
                            from hermes_cli.models import detect_provider_for_model
                            detected = detect_provider_for_model(use_model, default_provider or "")
                            if detected:
                                use_provider, use_model = detected
                        except Exception:
                            log.debug("web-chat: provider auto-detect failed for model=%s", use_model, exc_info=True)
                    # Effort: explicit per-turn override wins; else the config's
                    # resolved reasoning config (per-model override > global).
                    reasoning_config = None
                    if effort:
                        from hermes_constants import parse_reasoning_effort
                        reasoning_config = parse_reasoning_effort(effort)
                    else:
                        from hermes_constants import resolve_reasoning_config
                        reasoning_config = resolve_reasoning_config(cfg, use_model)
                    def _agent_factory(**kwargs):
                        return AIAgent(
                            model=use_model, provider=use_provider,
                            reasoning_config=reasoning_config, **kwargs)
                    agent = _get_active_agent(
                        session_id,
                        profile,
                        _agent_factory,
                        history=agent_history,
                        model=use_model,
                        callbacks={
                            "tool_start_callback": _on_tool_start,
                            "tool_complete_callback": _on_tool_complete,
                            "stream_delta_callback": _on_delta,
                            "clarify_callback": _on_clarify,
                        },
                    )
                    response = _run_agent_turn(agent, user_text)
                    result_holder.append(response or "")
                except Exception as exc:
                    log.exception("web-chat agent error"); error_holder.append(str(exc))
            thread = threading.Thread(target=_run_agent, daemon=True); thread.start()
            full_parts: list[str] = []
            try:
                while thread.is_alive() or not q.empty():
                    try: frame = await asyncio.wait_for(q.get(), timeout=0.1)
                    except asyncio.TimeoutError: continue
                    if frame.get("type") == "delta": full_parts.append(frame.get("text", ""))
                    await ws.send_text(json.dumps(frame))
            except WebSocketDisconnect:
                return
            thread.join(timeout=5)
            _turn_total_ms = (time.monotonic() - _turn_t0) * 1000.0
            _first_delta_ms = ((_first_delta_at[0] - _turn_t0) * 1000.0) if _first_delta_at else None
            _perf_append("turns.jsonl", {
                "session_id": session_id,
                "profile": profile or "default",
                "model": model or "",
                "ok": not bool(error_holder),
                "total_ms": round(_turn_total_ms, 1),
                "first_delta_ms": round(_first_delta_ms, 1) if _first_delta_ms is not None else None,
                "tool_calls": len(_tool_calls),
                "tool_names": _tool_calls[:10],
                "input_chars": len(user_text),
                "output_chars": len("".join(full_parts)) if full_parts else 0,
            })
            if error_holder:
                await ws.send_text(json.dumps({"type": "error", "text": error_holder[0]}))
            else:
                full = result_holder[0] if result_holder else "".join(full_parts)
                # The agent persisted the turn to state.db itself; just echo the
                # final text so the UI can finalize the streaming bubble.
                await ws.send_text(json.dumps({"type": "done", "text": full, "session_id": session_id}))
                await ws.send_text(json.dumps({"type": "clear"}))
    finally:
        _unregister_ws(session_id, ws)
        try:
            await ws.close()
        except Exception:
            pass
