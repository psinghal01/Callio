from django.db import connection
from django.db.utils import OperationalError
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.http import require_GET


def main_view(request):
    return render(request, "chat/main.html", context={})


@require_GET
def healthz(request):
    try:
        connection.ensure_connection()
        db_ok = True
    except OperationalError:
        db_ok = False

    payload = {
        "status": "ok" if db_ok else "unavailable",
        "database": db_ok,
    }
    return JsonResponse(payload, status=200 if db_ok else 503)
