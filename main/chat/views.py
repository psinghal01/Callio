from asgiref.sync import async_to_sync
from django.conf import settings
from django.contrib import messages
from django.db import connection
from django.db.utils import OperationalError
from django.http import JsonResponse
from django.shortcuts import redirect, render
from django.views.decorators.http import require_GET, require_http_methods, require_POST

from main.settings import ice_servers

from .rooms import RoomUnavailable, get_store, normalize_code, valid_code


def _page_host(request) -> str:
    raw = (request.get_host() or "").strip()
    if raw.startswith("["):
        end = raw.find("]")
        if end > 0:
            return raw[1:end]
        return raw
    return raw.split(":", 1)[0].strip()


def _redis_ok():
    url = getattr(settings, "REDIS_URL", "")
    if not url:
        return True
    try:
        import redis

        client = redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
        try:
            return bool(client.ping())
        finally:
            client.close()
    except Exception:
        return False


@require_GET
def lobby(request):
    return render(request, "chat/lobby.html")


@require_POST
def create_room(request):
    try:
        code = async_to_sync(get_store().create)()
    except RoomUnavailable:
        messages.error(request, "Rooms are temporarily unavailable. Try again in a moment.")
        return redirect("lobby")
    return redirect("room", room_code=code)


@require_POST
def join_room(request):
    code = normalize_code(request.POST.get("code"))
    if not valid_code(code):
        messages.error(request, "Enter a valid room code.")
        return redirect("lobby")
    try:
        room = async_to_sync(get_store().get)(code)
    except RoomUnavailable:
        messages.error(request, "Rooms are temporarily unavailable. Try again in a moment.")
        return redirect("lobby")
    if not room:
        messages.error(request, "Room not found or it has expired.")
        return redirect("lobby")
    return redirect("room", room_code=code)


@require_http_methods(["GET"])
def room_view(request, room_code):
    code = normalize_code(room_code)
    if not valid_code(code):
        messages.error(request, "That room code is not valid.")
        return redirect("lobby")
    if code != room_code:
        return redirect("room", room_code=code)
    try:
        room = async_to_sync(get_store().get)(code)
    except RoomUnavailable:
        room = None
        messages.error(request, "Rooms are temporarily unavailable.")
    return render(
        request,
        "chat/main.html",
        {
            "room_code": code,
            "room_exists": room is not None,
            "room_config": {
                "code": code,
                "exists": room is not None,
                "maxParticipants": min(int(getattr(settings, "ROOM_MAX_PARTICIPANTS", 20)), 20),
                "iceServers": ice_servers(client_host=_page_host(request)),
            },
        },
    )


@require_GET
def healthz(request):
    try:
        connection.ensure_connection()
        db_ok = True
    except OperationalError:
        db_ok = False

    redis_ok = _redis_ok()
    healthy = db_ok and redis_ok
    return JsonResponse(
        {"status": "ok" if healthy else "unavailable", "database": db_ok, "redis": redis_ok},
        status=200 if healthy else 503,
    )
