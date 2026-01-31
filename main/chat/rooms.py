"""Ephemeral rooms: Redis when configured, in-process memory otherwise.

Rooms are not stored in Postgres. Redis TTLs delete idle/empty rooms.
"""

from __future__ import annotations

import asyncio
import json
import re
import secrets
import time
from typing import Any

from django.conf import settings

CODE_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"
USERNAME_RE = re.compile(r"^[\w .'-]{1,32}$", re.UNICODE)


class RoomError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(message)


class RoomUnavailable(RoomError):
    def __init__(self, message="Rooms are temporarily unavailable."):
        super().__init__("unavailable", message)


def max_participants() -> int:
    return max(1, min(int(getattr(settings, "ROOM_MAX_PARTICIPANTS", 20)), 20))


def code_length() -> int:
    return max(4, min(int(getattr(settings, "ROOM_CODE_LENGTH", 6)), 12))


def room_ttl() -> int:
    return max(60, int(getattr(settings, "ROOM_TTL_SECONDS", 86400)))


def empty_ttl() -> int:
    return max(30, int(getattr(settings, "ROOM_EMPTY_TTL_SECONDS", 600)))


def normalize_code(raw: str | None) -> str:
    return (raw or "").strip().lower()


def valid_code(code: str) -> bool:
    if not code or len(code) > 16:
        return False
    return all(ch in CODE_ALPHABET for ch in code)


def generate_code() -> str:
    length = code_length()
    return "".join(secrets.choice(CODE_ALPHABET) for _ in range(length))


def normalize_username(raw: str | None) -> str:
    return " ".join((raw or "").split())


def validate_username(display: str) -> str:
    if not display or not USERNAME_RE.match(display):
        raise RoomError(
            "invalid_username",
            "Use 1–32 letters, numbers, spaces, or . _ - '",
        )
    return display


def username_key(display: str) -> str:
    return display.casefold()


def _now() -> float:
    return time.time()


def _user_payload(
    *,
    display: str,
    channel: str,
    state: str,
    is_host: bool,
    joined_at: float | None = None,
) -> dict[str, Any]:
    return {
        "username": display,
        "channel": channel,
        "state": state,
        "is_host": is_host,
        "joined_at": joined_at if joined_at is not None else _now(),
    }


def _snapshot(code: str, meta: dict[str, Any], users: dict[str, dict[str, Any]]) -> dict[str, Any]:
    admitted = sorted(
        [u for u in users.values() if u.get("state") == "admitted"],
        key=lambda u: u.get("joined_at") or 0,
    )
    waiting = sorted(
        [u for u in users.values() if u.get("state") == "waiting"],
        key=lambda u: u.get("joined_at") or 0,
    )
    host = meta.get("host") or ""
    return {
        "code": code,
        "open_for_all": bool(meta.get("open_for_all")),
        "host": host,
        "status": meta.get("status") or "open",
        "admitted": [
            {"username": u["username"], "is_host": bool(u.get("is_host"))} for u in admitted
        ],
        "waiting": [{"username": u["username"]} for u in waiting],
        "admitted_count": len(admitted),
        "waiting_count": len(waiting),
        "max": max_participants(),
        "host_channel": next((u["channel"] for u in users.values() if u.get("is_host")), ""),
    }


class _BaseStore:
    async def create(self) -> str:
        raise NotImplementedError

    async def get(self, code: str) -> dict[str, Any] | None:
        raise NotImplementedError

    async def has_admitted_channel(self, code: str, channel: str) -> bool:
        raise NotImplementedError

    async def join(
        self, code: str, username: str, channel: str, replace: bool = False
    ) -> dict[str, Any]:
        raise NotImplementedError

    async def leave(self, code: str, username: str, channel: str | None = None) -> dict[str, Any]:
        raise NotImplementedError

    async def admit(self, code: str, host: str, target: str) -> dict[str, Any]:
        raise NotImplementedError

    async def deny(self, code: str, host: str, target: str) -> dict[str, Any]:
        raise NotImplementedError

    async def set_open_for_all(self, code: str, host: str, enabled: bool) -> dict[str, Any]:
        raise NotImplementedError


class MemoryRoomStore(_BaseStore):
    def __init__(self):
        self._rooms: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    def _purge_locked(self) -> None:
        now = _now()
        dead = [c for c, room in self._rooms.items() if room.get("expires_at", 0) <= now]
        for code in dead:
            self._rooms.pop(code, None)

    def _touch(self, room: dict[str, Any], empty: bool) -> None:
        room["expires_at"] = _now() + room_ttl()

    def _ensure(self, code: str) -> dict[str, Any]:
        self._purge_locked()
        room = self._rooms.get(code)
        if not room:
            raise RoomError("not_found", "Room not found or it has expired.")
        if room["meta"].get("status") == "closed":
            raise RoomError("closed", "This room has closed.")
        return room

    async def create(self) -> str:
        async with self._lock:
            self._purge_locked()
            for _ in range(32):
                code = generate_code()
                if code not in self._rooms:
                    self._rooms[code] = {
                        "meta": {
                            "host": "",
                            "open_for_all": False,
                            "status": "open",
                            "created_at": _now(),
                        },
                        "users": {},
                        "expires_at": _now() + room_ttl(),
                    }
                    return code
        raise RoomUnavailable("Could not allocate a room code.")

    async def get(self, code: str) -> dict[str, Any] | None:
        async with self._lock:
            self._purge_locked()
            room = self._rooms.get(code)
            if not room:
                return None
            self._touch(room, False)
            return _snapshot(code, room["meta"], room["users"])

    async def has_admitted_channel(self, code: str, channel: str) -> bool:
        if not channel:
            return False
        async with self._lock:
            self._purge_locked()
            room = self._rooms.get(code)
            if not room:
                return False
            return any(
                u.get("channel") == channel and u.get("state") == "admitted"
                for u in room["users"].values()
            )

    async def join(
        self, code: str, username: str, channel: str, replace: bool = False
    ) -> dict[str, Any]:
        display = validate_username(normalize_username(username))
        key = username_key(display)
        async with self._lock:
            room = self._ensure(code)
            users: dict[str, dict[str, Any]] = room["users"]
            meta = room["meta"]
            replaced = None
            existing = users.get(key)
            if existing:
                same_socket = existing.get("channel") == channel
                if not same_socket and existing.get("channel") and not replace:
                    raise RoomError(
                        "name_taken",
                        "That name is already in this meeting. Pick another, or continue if it’s you.",
                    )
                if existing.get("channel") and existing["channel"] != channel:
                    replaced = existing["channel"]
                existing["channel"] = channel
                existing["username"] = display
                empty = False
                self._touch(room, empty)
                return {
                    "state": existing["state"],
                    "is_host": bool(existing.get("is_host")),
                    "replaced_channel": replaced,
                    "room": _snapshot(code, meta, users),
                }

            admitted = [u for u in users.values() if u["state"] == "admitted"]
            is_first = len(users) == 0
            open_for_all = bool(meta.get("open_for_all"))
            if is_first:
                state, is_host = "admitted", True
                meta["host"] = display
            elif open_for_all and len(admitted) < max_participants():
                state, is_host = "admitted", False
            else:
                if not open_for_all or len(admitted) >= max_participants():
                    state, is_host = "waiting", False
                else:
                    state, is_host = "waiting", False

            users[key] = _user_payload(
                display=display, channel=channel, state=state, is_host=is_host
            )
            self._touch(room, False)
            return {
                "state": state,
                "is_host": is_host,
                "replaced_channel": None,
                "room": _snapshot(code, meta, users),
            }

    def _auto_admit_waiters(self, meta: dict, users: dict) -> list[dict[str, Any]]:
        admitted_n = sum(1 for u in users.values() if u["state"] == "admitted")
        slots = max_participants() - admitted_n
        if slots <= 0:
            return []
        waiters = sorted(
            [u for u in users.values() if u["state"] == "waiting"],
            key=lambda u: u.get("joined_at") or 0,
        )
        promoted = []
        for waiter in waiters[:slots]:
            waiter["state"] = "admitted"
            waiter["is_host"] = False
            promoted.append(waiter)
        return promoted

    def _transfer_host(self, meta: dict, users: dict) -> dict[str, Any] | None:
        admitted = sorted(
            [u for u in users.values() if u["state"] == "admitted"],
            key=lambda u: u.get("joined_at") or 0,
        )
        if admitted:
            new_host = admitted[0]
        else:
            waiting = sorted(
                [u for u in users.values() if u["state"] == "waiting"],
                key=lambda u: u.get("joined_at") or 0,
            )
            if not waiting:
                meta["host"] = ""
                return None
            new_host = waiting[0]
            new_host["state"] = "admitted"
        for u in users.values():
            u["is_host"] = u is new_host
        meta["host"] = new_host["username"]
        return new_host

    async def leave(self, code: str, username: str, channel: str | None = None) -> dict[str, Any]:
        key = username_key(normalize_username(username))
        async with self._lock:
            self._purge_locked()
            room = self._rooms.get(code)
            if not room:
                return {"gone": True, "room": None, "promoted": [], "new_host": None, "left": None}
            users = room["users"]
            meta = room["meta"]
            existing = users.get(key)
            if not existing:
                return {
                    "gone": False,
                    "room": _snapshot(code, meta, users),
                    "promoted": [],
                    "new_host": None,
                    "left": None,
                }
            if channel and existing.get("channel") and existing["channel"] != channel:
                return {
                    "gone": False,
                    "stale": True,
                    "room": _snapshot(code, meta, users),
                    "promoted": [],
                    "new_host": None,
                    "left": None,
                }
            left = existing
            was_host = bool(existing.get("is_host"))
            users.pop(key, None)
            new_host = None
            promoted: list[dict[str, Any]] = []
            if users and was_host:
                new_host = self._transfer_host(meta, users)
            if users and meta.get("open_for_all"):
                promoted = self._auto_admit_waiters(meta, users)
            empty = not users
            if empty:
                meta["host"] = ""
            self._touch(room, empty)
            return {
                "gone": False,
                "room": _snapshot(code, meta, users) if users else None,
                "empty": empty,
                "promoted": promoted,
                "new_host": new_host,
                "left": left,
            }

    def _require_host(self, meta: dict, users: dict, host: str) -> dict[str, Any]:
        key = username_key(normalize_username(host))
        actor = users.get(key)
        if not actor or not actor.get("is_host"):
            raise RoomError("not_host", "Only the host can do that.")
        return actor

    async def admit(self, code: str, host: str, target: str) -> dict[str, Any]:
        target_key = username_key(normalize_username(target))
        async with self._lock:
            room = self._ensure(code)
            users, meta = room["users"], room["meta"]
            self._require_host(meta, users, host)
            guest = users.get(target_key)
            if not guest:
                raise RoomError("not_found", "That person is no longer waiting.")
            if guest["state"] == "admitted":
                return {"guest": guest, "room": _snapshot(code, meta, users), "already": True}
            admitted_n = sum(1 for u in users.values() if u["state"] == "admitted")
            if admitted_n >= max_participants():
                raise RoomError("full", f"Room is full ({max_participants()} people).")
            guest["state"] = "admitted"
            self._touch(room, False)
            return {"guest": guest, "room": _snapshot(code, meta, users), "already": False}

    async def deny(self, code: str, host: str, target: str) -> dict[str, Any]:
        target_key = username_key(normalize_username(target))
        async with self._lock:
            room = self._ensure(code)
            users, meta = room["users"], room["meta"]
            self._require_host(meta, users, host)
            guest = users.get(target_key)
            if not guest:
                raise RoomError("not_found", "That person is no longer waiting.")
            if guest["state"] != "waiting":
                raise RoomError("not_waiting", "That person is already in the call.")
            users.pop(target_key, None)
            self._touch(room, not users)
            return {"guest": guest, "room": _snapshot(code, meta, users)}

    async def set_open_for_all(self, code: str, host: str, enabled: bool) -> dict[str, Any]:
        async with self._lock:
            room = self._ensure(code)
            users, meta = room["users"], room["meta"]
            self._require_host(meta, users, host)
            meta["open_for_all"] = bool(enabled)
            promoted: list[dict[str, Any]] = []
            if enabled:
                promoted = self._auto_admit_waiters(meta, users)
            self._touch(room, not users)
            return {"room": _snapshot(code, meta, users), "promoted": promoted}


class RedisRoomStore(_BaseStore):
    def __init__(self):
        self._client = None

    async def _redis(self):
        if self._client is None:
            import redis.asyncio as redis_async

            self._client = redis_async.from_url(
                settings.REDIS_URL,
                decode_responses=True,
                socket_connect_timeout=3,
                socket_timeout=5,
            )
        return self._client

    def _rk(self, code: str) -> str:
        return f"callio:room:{code}"

    def _uk(self, code: str) -> str:
        return f"callio:room:{code}:users"

    def _lk(self, code: str) -> str:
        return f"callio:room:{code}:lock"

    async def _touch(self, r, code: str, empty: bool) -> None:
        ttl = room_ttl()
        await r.expire(self._rk(code), ttl)
        await r.expire(self._uk(code), ttl)

    async def _load(self, r, code: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
        raw_meta = await r.hgetall(self._rk(code))
        if not raw_meta:
            raise RoomError("not_found", "Room not found or it has expired.")
        if raw_meta.get("status") == "closed":
            raise RoomError("closed", "This room has closed.")
        meta = {
            "host": raw_meta.get("host") or "",
            "open_for_all": raw_meta.get("open_for_all") == "1",
            "status": raw_meta.get("status") or "open",
            "created_at": float(raw_meta.get("created_at") or 0),
        }
        raw_users = await r.hgetall(self._uk(code))
        users = {}
        for key, payload in raw_users.items():
            try:
                users[key] = json.loads(payload)
            except json.JSONDecodeError:
                continue
        return meta, users

    async def _save_meta(self, r, code: str, meta: dict[str, Any]) -> None:
        await r.hset(
            self._rk(code),
            mapping={
                "host": meta.get("host") or "",
                "open_for_all": "1" if meta.get("open_for_all") else "0",
                "status": meta.get("status") or "open",
                "created_at": str(meta.get("created_at") or _now()),
            },
        )

    async def _save_user(self, r, code: str, user: dict[str, Any]) -> None:
        await r.hset(self._uk(code), username_key(user["username"]), json.dumps(user))

    async def _delete_user(self, r, code: str, display: str) -> None:
        await r.hdel(self._uk(code), username_key(display))

    async def create(self) -> str:
        try:
            r = await self._redis()
            for _ in range(32):
                code = generate_code()
                created = await r.hsetnx(self._rk(code), "status", "open")
                if not created:
                    continue
                await r.hset(
                    self._rk(code),
                    mapping={
                        "host": "",
                        "open_for_all": "0",
                        "created_at": str(_now()),
                    },
                )
                await self._touch(r, code, empty=True)
                return code
        except RoomError:
            raise
        except Exception as exc:
            raise RoomUnavailable() from exc
        raise RoomUnavailable("Could not allocate a room code.")

    async def get(self, code: str) -> dict[str, Any] | None:
        try:
            r = await self._redis()
            if not await r.exists(self._rk(code)):
                return None
            meta, users = await self._load(r, code)
            await self._touch(r, code, empty=False)
            return _snapshot(code, meta, users)
        except RoomError:
            return None
        except Exception as exc:
            raise RoomUnavailable() from exc

    async def has_admitted_channel(self, code: str, channel: str) -> bool:
        if not channel:
            return False
        try:
            r = await self._redis()
            _meta, users = await self._load(r, code)
            return any(
                u.get("channel") == channel and u.get("state") == "admitted"
                for u in users.values()
            )
        except RoomError:
            return False
        except Exception:
            return False

    async def _with_lock(self, code: str, fn):
        r = await self._redis()
        lock = r.lock(self._lk(code), timeout=5, blocking_timeout=3)
        try:
            async with lock:
                return await fn(r)
        except RoomError:
            raise
        except Exception as exc:
            raise RoomUnavailable() from exc

    async def join(
        self, code: str, username: str, channel: str, replace: bool = False
    ) -> dict[str, Any]:
        display = validate_username(normalize_username(username))
        key = username_key(display)

        async def _do(r):
            meta, users = await self._load(r, code)
            replaced = None
            existing = users.get(key)
            if existing:
                same_socket = existing.get("channel") == channel
                if not same_socket and existing.get("channel") and not replace:
                    raise RoomError(
                        "name_taken",
                        "That name is already in this meeting. Pick another, or continue if it’s you.",
                    )
                if existing.get("channel") and existing["channel"] != channel:
                    replaced = existing["channel"]
                existing["channel"] = channel
                existing["username"] = display
                await self._save_user(r, code, existing)
                await self._touch(r, code, empty=False)
                return {
                    "state": existing["state"],
                    "is_host": bool(existing.get("is_host")),
                    "replaced_channel": replaced,
                    "room": _snapshot(code, meta, users),
                }

            admitted = [u for u in users.values() if u["state"] == "admitted"]
            is_first = len(users) == 0
            open_for_all = bool(meta.get("open_for_all"))
            if is_first:
                state, is_host = "admitted", True
                meta["host"] = display
                await self._save_meta(r, code, meta)
            elif open_for_all and len(admitted) < max_participants():
                state, is_host = "admitted", False
            else:
                state, is_host = "waiting", False

            user = _user_payload(display=display, channel=channel, state=state, is_host=is_host)
            users[key] = user
            await self._save_user(r, code, user)
            await self._touch(r, code, empty=False)
            return {
                "state": state,
                "is_host": is_host,
                "replaced_channel": None,
                "room": _snapshot(code, meta, users),
            }

        return await self._with_lock(code, _do)

    def _auto_admit_waiters(self, meta: dict, users: dict) -> list[dict[str, Any]]:
        admitted_n = sum(1 for u in users.values() if u["state"] == "admitted")
        slots = max_participants() - admitted_n
        if slots <= 0:
            return []
        waiters = sorted(
            [u for u in users.values() if u["state"] == "waiting"],
            key=lambda u: u.get("joined_at") or 0,
        )
        promoted = []
        for waiter in waiters[:slots]:
            waiter["state"] = "admitted"
            waiter["is_host"] = False
            promoted.append(waiter)
        return promoted

    def _transfer_host(self, meta: dict, users: dict) -> dict[str, Any] | None:
        admitted = sorted(
            [u for u in users.values() if u["state"] == "admitted"],
            key=lambda u: u.get("joined_at") or 0,
        )
        if admitted:
            new_host = admitted[0]
        else:
            waiting = sorted(
                [u for u in users.values() if u["state"] == "waiting"],
                key=lambda u: u.get("joined_at") or 0,
            )
            if not waiting:
                meta["host"] = ""
                return None
            new_host = waiting[0]
            new_host["state"] = "admitted"
        for u in users.values():
            u["is_host"] = u is new_host
        meta["host"] = new_host["username"]
        return new_host

    async def leave(self, code: str, username: str, channel: str | None = None) -> dict[str, Any]:
        key = username_key(normalize_username(username))

        async def _do(r):
            try:
                meta, users = await self._load(r, code)
            except RoomError:
                return {"gone": True, "room": None, "promoted": [], "new_host": None, "left": None}
            existing = users.get(key)
            if not existing:
                return {
                    "gone": False,
                    "room": _snapshot(code, meta, users),
                    "promoted": [],
                    "new_host": None,
                    "left": None,
                }
            if channel and existing.get("channel") and existing["channel"] != channel:
                return {
                    "gone": False,
                    "stale": True,
                    "room": _snapshot(code, meta, users),
                    "promoted": [],
                    "new_host": None,
                    "left": None,
                }
            left = existing
            was_host = bool(existing.get("is_host"))
            users.pop(key, None)
            await r.hdel(self._uk(code), key)
            new_host = None
            promoted: list[dict[str, Any]] = []
            if users and was_host:
                new_host = self._transfer_host(meta, users)
            if users and meta.get("open_for_all"):
                promoted = self._auto_admit_waiters(meta, users)
            if users:
                await self._save_meta(r, code, meta)
                for u in users.values():
                    await self._save_user(r, code, u)
                await self._touch(r, code, empty=False)
                return {
                    "gone": False,
                    "room": _snapshot(code, meta, users),
                    "empty": False,
                    "promoted": promoted,
                    "new_host": new_host,
                    "left": left,
                }
            meta["host"] = ""
            await self._save_meta(r, code, meta)
            await self._touch(r, code, empty=True)
            return {
                "gone": False,
                "room": None,
                "empty": True,
                "promoted": [],
                "new_host": None,
                "left": left,
            }

        try:
            return await self._with_lock(code, _do)
        except RoomUnavailable:
            return {"gone": True, "room": None, "promoted": [], "new_host": None, "left": None}

    def _require_host(self, users: dict, host: str) -> dict[str, Any]:
        actor = users.get(username_key(normalize_username(host)))
        if not actor or not actor.get("is_host"):
            raise RoomError("not_host", "Only the host can do that.")
        return actor

    async def admit(self, code: str, host: str, target: str) -> dict[str, Any]:
        target_key = username_key(normalize_username(target))

        async def _do(r):
            meta, users = await self._load(r, code)
            self._require_host(users, host)
            guest = users.get(target_key)
            if not guest:
                raise RoomError("not_found", "That person is no longer waiting.")
            if guest["state"] == "admitted":
                return {"guest": guest, "room": _snapshot(code, meta, users), "already": True}
            admitted_n = sum(1 for u in users.values() if u["state"] == "admitted")
            if admitted_n >= max_participants():
                raise RoomError("full", f"Room is full ({max_participants()} people).")
            guest["state"] = "admitted"
            await self._save_user(r, code, guest)
            await self._touch(r, code, empty=False)
            return {"guest": guest, "room": _snapshot(code, meta, users), "already": False}

        return await self._with_lock(code, _do)

    async def deny(self, code: str, host: str, target: str) -> dict[str, Any]:
        target_key = username_key(normalize_username(target))

        async def _do(r):
            meta, users = await self._load(r, code)
            self._require_host(users, host)
            guest = users.get(target_key)
            if not guest:
                raise RoomError("not_found", "That person is no longer waiting.")
            if guest["state"] != "waiting":
                raise RoomError("not_waiting", "That person is already in the call.")
            await r.hdel(self._uk(code), target_key)
            users.pop(target_key, None)
            await self._touch(r, code, not users)
            return {"guest": guest, "room": _snapshot(code, meta, users)}

        return await self._with_lock(code, _do)

    async def set_open_for_all(self, code: str, host: str, enabled: bool) -> dict[str, Any]:
        async def _do(r):
            meta, users = await self._load(r, code)
            self._require_host(users, host)
            meta["open_for_all"] = bool(enabled)
            promoted: list[dict[str, Any]] = []
            if enabled:
                promoted = self._auto_admit_waiters(meta, users)
                for user in users.values():
                    await self._save_user(r, code, user)
            await self._save_meta(r, code, meta)
            await self._touch(r, code, not users)
            return {"room": _snapshot(code, meta, users), "promoted": promoted}

        return await self._with_lock(code, _do)


_store: _BaseStore | None = None


def get_store() -> _BaseStore:
    global _store
    if _store is None:
        if getattr(settings, "REDIS_URL", ""):
            _store = RedisRoomStore()
        else:
            _store = MemoryRoomStore()
    return _store
