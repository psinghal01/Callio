from django.urls import path

from .views import healthz, main_view

urlpatterns = [
    path("", main_view, name="main_view"),
    path("healthz/", healthz, name="healthz"),
]
