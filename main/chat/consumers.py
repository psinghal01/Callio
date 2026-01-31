import json

from channels.generic.websocket import AsyncWebsocketConsumer

from .rooms import RoomError, RoomUnavailable, get_store, valid_code


class ChatConsumer(AsyncWebsocketConsumer):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.room_code = ""
        self.username = ""
        self.state = ""
        self.is_host = False
        self._joined = False
        self._suppress_leave = False

    async def connect(self):
        raw = (self.scope.get("url_route") or {}).get("kwargs", {}).get("room_code", "")
        self.room_code = (raw or "").strip().lower()
        if not valid_code(self.room_code):
            await self.close(code=4400)
            return
        try:
            room = await get_store().get(self.room_code)
        except RoomUnavailable:
            await self.close(code=1013)
            return
        if not room:
            await self.close(code=4404)
            return
        await self.accept()

    async def disconnect(self, close_code):
        if self._suppress_leave or not self._joined or not self.username:
            return
        try:
            result = await get_store().leave(self.room_code, self.username, self.channel_name)
        except (RoomError, RoomUnavailable):
            return
        if result.get("stale") or result.get("gone"):
            return
        if self.state == "admitted":
            await self._discard_call_group()
            left = (result.get("left") or {}).get("username") or self.username
            await self._broadcast_call({"action": "peer-left", "peer": left})
        await self._promote_and_notify(result)
        room = result.get("room")
        if room:
            await self._push_waiting(room)
            if result.get("new_host"):
                await self._notify_host_changed(room)

    async def receive(self, text_data):
        try:
            data = json.loads(text_data)
        except (TypeError, json.JSONDecodeError):
            await self._error("bad_payload", "Invalid message.")
            return
        if not isinstance(data, dict):
            await self._error("bad_payload", "Invalid message.")
            return

        action = data.get("action")
        if action == "join":
            await self._handle_join(data)
            return
        if not self._joined:
            await self._error("not_joined", "Join the room first.")
            return

        if action == "admit":
            await self._handle_admit(data)
            return
        if action == "deny":
            await self._handle_deny(data)
            return
        if action == "set-open-for-all":
            await self._handle_settings(data)
            return
        if action in ("new-peer", "new-offer", "new-answer"):
            await self._handle_signal(data)
            return
        await self._error("unknown_action", "Unknown action.")

    async def send_sdp(self, event):
        await self.send(text_data=json.dumps(event["receive_dict"]))

    async def send_room(self, event):
        await self.send(text_data=json.dumps(event["payload"]))

    async def room_admitted(self, event):
        self.state = "admitted"
        self.is_host = bool(event.get("is_host"))
        await self._add_call_group()
        await self.send(text_data=json.dumps(event["payload"]))

    async def room_denied(self, event):
        self._suppress_leave = True
        self._joined = False
        await self.send(text_data=json.dumps(event["payload"]))
        await self.close(code=4403)

    async def room_replaced(self, event):
        self._suppress_leave = True
        self._joined = False
        await self._discard_call_group()
        await self.send(text_data=json.dumps(event["payload"]))
        await self.close(code=4402)

    def _call_group(self) -> str:
        return f"room_{self.room_code}_call"

    async def _error(self, code: str, message: str):
        await self.send(text_data=json.dumps({"action": "error", "code": code, "message": message}))

    async def _send(self, payload: dict):
        await self.send(text_data=json.dumps(payload))

    async def _to_channel(self, channel: str, payload: dict):
        if not channel:
            return
        await self.channel_layer.send(channel, {"type": "send.room", "payload": payload})

    async def _admit_channel(self, channel: str, is_host: bool, payload: dict):
        if not channel:
            return
        await self.channel_layer.send(
            channel,
            {"type": "room.admitted", "is_host": is_host, "payload": payload},
        )

    async def _broadcast_call(self, payload: dict):
        await self.channel_layer.group_send(
            self._call_group(),
            {"type": "send.room", "payload": payload},
        )

    async def _add_call_group(self):
        await self.channel_layer.group_add(self._call_group(), self.channel_name)

    async def _discard_call_group(self):
        await self.channel_layer.group_discard(self._call_group(), self.channel_name)

    async def _handle_join(self, data):
        if self._joined:
            await self._error("already_joined", "You already joined this room.")
            return
        username = data.get("username") or data.get("peer")
        replace = data.get("replace")
        if isinstance(replace, str):
            replace = replace.lower() in ("1", "true", "yes", "on")
        replace = bool(replace)
        try:
            result = await get_store().join(
                self.room_code, username, self.channel_name, replace=replace
            )
        except RoomError as exc:
            await self._error(exc.code, exc.message)
            if exc.code in ("name_taken", "invalid_username"):
                return
            await self.close(code=4401)
            return
        except RoomUnavailable as exc:
            await self._error(exc.code, exc.message)
            await self.close(code=1013)
            return

        replaced_channel = result.get("replaced_channel")
        if replaced_channel:
            await self.channel_layer.send(
                replaced_channel,
                {
                    "type": "room.replaced",
                    "payload": {
                        "action": "replaced",
                        "message": "You joined from another tab. This session was disconnected.",
                    },
                },
            )
            await self.channel_layer.group_discard(self._call_group(), replaced_channel)

        self.username = self._display_from_room(result["room"], username)
        self.state = result["state"]
        self.is_host = result["is_host"]
        self._joined = True

        room = result["room"]
        # Old media session is dead; seat stays. Others must drop the stale PC
        # before this tab joins the call group and announces itself.
        if replaced_channel and self.state == "admitted":
            await self._broadcast_call(
                {"action": "peer-left", "peer": self.username, "reason": "replaced"}
            )

        await self._send(
            {
                "action": "join-result",
                "state": self.state,
                "is_host": self.is_host,
                "open_for_all": room["open_for_all"],
                "room": room,
            }
        )
        if self.state == "admitted":
            await self._add_call_group()
        await self._push_waiting(room)

    def _display_from_room(self, room: dict, raw_username: str) -> str:
        wanted = (raw_username or "").strip().casefold()
        for bucket in ("admitted", "waiting"):
            for person in room.get(bucket) or []:
                if person["username"].casefold() == wanted:
                    return person["username"]
        return (raw_username or "").strip()

    def _target_name(self, data) -> str:
        message = data.get("message") if isinstance(data.get("message"), dict) else {}
        return (data.get("username") or message.get("username") or "").strip()

    async def _handle_admit(self, data):
        target = self._target_name(data)
        try:
            result = await get_store().admit(self.room_code, self.username, target)
        except RoomError as exc:
            await self._error(exc.code, exc.message)
            return
        except RoomUnavailable as exc:
            await self._error(exc.code, exc.message)
            return
        guest = result["guest"]
        room = result["room"]
        if not result.get("already"):
            await self._admit_channel(
                guest.get("channel"),
                False,
                {"action": "admitted", "is_host": False, "room": room},
            )
        await self._push_waiting(room)

    async def _handle_deny(self, data):
        target = self._target_name(data)
        try:
            result = await get_store().deny(self.room_code, self.username, target)
        except RoomError as exc:
            await self._error(exc.code, exc.message)
            return
        except RoomUnavailable as exc:
            await self._error(exc.code, exc.message)
            return
        guest = result["guest"]
        if guest.get("channel"):
            await self.channel_layer.send(
                guest["channel"],
                {
                    "type": "room.denied",
                    "payload": {"action": "denied", "message": "The host declined your join request."},
                },
            )
        await self._push_waiting(result["room"])

    async def _handle_settings(self, data):
        message = data.get("message") if isinstance(data.get("message"), dict) else {}
        enabled = data.get("open_for_all", message.get("open_for_all"))
        if isinstance(enabled, str):
            enabled = enabled.lower() in ("1", "true", "yes", "on")
        enabled = bool(enabled)
        try:
            result = await get_store().set_open_for_all(self.room_code, self.username, enabled)
        except RoomError as exc:
            await self._error(exc.code, exc.message)
            return
        except RoomUnavailable as exc:
            await self._error(exc.code, exc.message)
            return
        room = result["room"]
        await self._broadcast_call(
            {"action": "settings", "open_for_all": room["open_for_all"], "room": room}
        )
        await self._promote_and_notify(result)
        await self._push_waiting(room)

    async def _handle_signal(self, data):
        if self.state != "admitted":
            await self._error("not_admitted", "Wait to be admitted before connecting.")
            return
        action = data.get("action")
        message = data.get("message") if isinstance(data.get("message"), dict) else {}
        payload = {
            "peer": self.username,
            "action": action,
            "message": {**message, "receiver_channel_name": self.channel_name},
        }
        if action in ("new-offer", "new-answer"):
            target = message.get("receiver_channel_name")
            if not target or not isinstance(target, str):
                await self._error("bad_payload", "Missing receiver.")
                return
            await self.channel_layer.send(
                target,
                {"type": "send.sdp", "receive_dict": payload},
            )
            return
        await self.channel_layer.group_send(
            self._call_group(),
            {"type": "send.sdp", "receive_dict": payload},
        )

    async def _push_waiting(self, room: dict | None):
        if not room:
            return
        payload = {
            "action": "waiting-update",
            "waiting": room.get("waiting") or [],
            "admitted": room.get("admitted") or [],
            "admitted_count": room.get("admitted_count"),
            "max": room.get("max"),
            "open_for_all": room.get("open_for_all"),
            "host": room.get("host"),
        }
        await self._to_channel(room.get("host_channel") or "", payload)
        await self._broadcast_call(payload)

    async def _promote_and_notify(self, result: dict):
        room = result.get("room")
        for guest in result.get("promoted") or []:
            await self._admit_channel(
                guest.get("channel"),
                bool(guest.get("is_host")),
                {
                    "action": "admitted",
                    "is_host": bool(guest.get("is_host")),
                    "room": room,
                },
            )
        new_host = result.get("new_host")
        if new_host and room:
            await self._admit_channel(
                new_host.get("channel"),
                True,
                {"action": "admitted", "is_host": True, "room": room},
            )
            await self._notify_host_changed(room)

    async def _notify_host_changed(self, room: dict):
        await self._broadcast_call(
            {"action": "host-changed", "host": room.get("host"), "is_host": False, "room": room}
        )
        if room.get("host_channel"):
            await self._to_channel(
                room["host_channel"],
                {"action": "host-changed", "host": room.get("host"), "is_host": True, "room": room},
            )
