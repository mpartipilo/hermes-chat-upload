"""Thin JSON-RPC WebSocket client for hermes serve (tui_gateway), one instance per
profile. Mirrors the pattern in ~/src/paduq/virgil/server.mjs's rpc()/broadcast(),
adapted from Node/SSE to Python asyncio/WS. See hermes-chat-frontend skill's
references/hermes-serve-ws-protocol.md for the wire contract.

Auth: each hermes serve daemon is bound to 0.0.0.0 (register-serve-slots.sh), so
should_require_auth() gates it regardless of the caller being on 127.0.0.1 --
confirmed live in Task 0 of the migration plan
(~/.hermes/plans/2026-09-14_090000-web-chat-hermes-serve-backend.md). This class
does the same login -> ws-ticket -> WS-upgrade dance virgil-chat's server.mjs
already does, using web-chat's OWN copy of each profile's dashboard.basic_auth
credential (serve_credentials.json, gitignored, chmod 600 -- never virgil's/
dev-chat's .env files directly, to avoid coupling web-chat's auth to another
plugin's files). This is a stored SERVICE credential applied automatically on
every connect, not a human-facing login -- no interactive prompt, ever.
"""
from __future__ import annotations

import asyncio
import itertools
import json
import logging
from pathlib import Path
from typing import Any, Callable, Optional

import httpx
import websockets

log = logging.getLogger(__name__)

# Fixed port table from ~/services/hermes/register-serve-slots.sh -- these are
# s6-registered slots INSIDE the hermes_hermes container; web-chat's plugin_api.py
# runs in that same container so 127.0.0.1 is correct (NOT the overlay hostname
# virgil-chat uses from its own separate container).
_SERVE_PORTS = {"default": 8650, "dante": 8647, "halloween-app-dev": 8646}

_CREDENTIALS_PATH = Path(__file__).parent / "serve_credentials.json"


def _load_credentials() -> dict[str, dict[str, Any]]:
    if not _CREDENTIALS_PATH.exists():
        raise RuntimeError(
            f"web-chat serve credentials missing: {_CREDENTIALS_PATH} "
            "(see hermes-chat-frontend skill / migration plan Task 1 for setup)")
    return json.loads(_CREDENTIALS_PATH.read_text(encoding="utf-8"))


class HermesServeClient:
    def __init__(self, profile: str):
        self.profile = profile or "default"
        self.port = _SERVE_PORTS.get(self.profile)
        if self.port is None:
            raise ValueError(f"no hermes serve port registered for profile {self.profile!r}")
        self._ws: Optional[Any] = None
        self._rpc_id = itertools.count(1)
        self._pending: dict[int, asyncio.Future] = {}
        self._event_handlers: list[Callable[[str, str, dict], None]] = []
        self._connect_lock = asyncio.Lock()
        self._recv_task: Optional[asyncio.Task] = None

    async def _login_and_get_ticket(self) -> str:
        """POST /auth/password-login (cookie) -> POST /api/auth/ws-ticket -> ticket.
        Verified end-to-end against port 8650 in Task 0; same route on 8647/8646."""
        creds = _load_credentials().get(self.profile)
        if not creds:
            raise RuntimeError(f"no stored serve credential for profile {self.profile!r}")
        base = f"http://127.0.0.1:{self.port}"
        async with httpx.AsyncClient(base_url=base, timeout=10.0) as client:
            login_resp = await client.post(
                "/auth/password-login",
                json={"provider": "basic", "username": creds["username"], "password": creds["password"]})
            if login_resp.status_code != 200:
                raise RuntimeError(
                    f"hermes serve login failed profile={self.profile} status={login_resp.status_code} "
                    f"body={login_resp.text[:200]!r}")
            ticket_resp = await client.post("/api/auth/ws-ticket")
            if ticket_resp.status_code != 200:
                raise RuntimeError(
                    f"hermes serve ws-ticket failed profile={self.profile} status={ticket_resp.status_code}")
            ticket = ticket_resp.json().get("ticket")
            if not ticket:
                raise RuntimeError(f"hermes serve ws-ticket response missing 'ticket' field")
            return ticket

    async def ensure_connected(self) -> None:
        async with self._connect_lock:
            # websockets>=14 dropped `.closed`; `.state` is the supported probe.
            # (websockets 15.0.1 in /opt/hermes/.venv -- verified live.)
            if self._ws is not None and getattr(self._ws, "state", None) is not None:
                from websockets.protocol import State
                if self._ws.state is State.OPEN:
                    return
                self._ws = None
            ticket = await self._login_and_get_ticket()
            url = f"ws://127.0.0.1:{self.port}/api/ws?ticket={ticket}"
            self._ws = await websockets.connect(url, ping_interval=20, ping_timeout=20)
            self._recv_task = asyncio.create_task(self._recv_loop())
            log.info("web-chat: connected to hermes serve profile=%s port=%s", self.profile, self.port)

    async def _recv_loop(self) -> None:
        try:
            async for raw in self._ws:
                try:
                    frame = json.loads(raw)
                except Exception:
                    continue
                if "id" in frame and frame["id"] in self._pending:
                    fut = self._pending.pop(frame["id"])
                    if not fut.done():
                        fut.set_result(frame)
                elif frame.get("method") == "event":
                    p = frame.get("params") or {}
                    for handler in list(self._event_handlers):
                        try:
                            handler(p.get("type", ""), p.get("session_id", ""), p.get("payload") or {})
                        except Exception:
                            log.exception("web-chat: event handler failed")
        except Exception:
            log.warning("web-chat: hermes serve WS closed (profile=%s)", self.profile, exc_info=True)
        finally:
            for fut in self._pending.values():
                if not fut.done():
                    fut.set_exception(ConnectionError("hermes serve WS closed"))
            self._pending.clear()
            self._ws = None

    def on_event(self, handler: Callable[[str, str, dict], None]) -> None:
        self._event_handlers.append(handler)

    async def rpc(self, method: str, params: dict, timeout: float = 30.0) -> dict:
        await self.ensure_connected()
        rid = next(self._rpc_id)
        fut: asyncio.Future = asyncio.get_event_loop().create_future()
        self._pending[rid] = fut
        await self._ws.send(json.dumps({"jsonrpc": "2.0", "id": rid, "method": method, "params": params}))
        try:
            frame = await asyncio.wait_for(fut, timeout=timeout)
        except asyncio.TimeoutError:
            self._pending.pop(rid, None)
            raise TimeoutError(f"hermes serve RPC timeout: {method}")
        if "error" in frame:
            err = frame["error"]
            raise RuntimeError(f"hermes serve RPC error {err.get('code')}: {err.get('message')}")
        return frame.get("result") or {}


_clients: dict[str, HermesServeClient] = {}


def get_client(profile: Optional[str]) -> HermesServeClient:
    key = profile or "default"
    if key not in _clients:
        _clients[key] = HermesServeClient(key)
    return _clients[key]
