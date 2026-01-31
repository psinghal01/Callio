from django.urls import path

from .views import create_room, healthz, join_room, lobby, room_view

urlpatterns = [
    path("", lobby, name="lobby"),
    path("rooms/create/", create_room, name="create_room"),
    path("rooms/join/", join_room, name="join_room"),
    path("room/<str:room_code>/", room_view, name="room"),
    path("healthz/", healthz, name="healthz"),
]
