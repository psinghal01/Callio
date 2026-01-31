import time

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = "Block until Redis accepts connections (no-op if REDIS_URL is unset)."

    def add_arguments(self, parser):
        parser.add_argument("--timeout", type=int, default=60)
        parser.add_argument("--interval", type=float, default=1.0)

    def handle(self, *args, **options):
        url = getattr(settings, "REDIS_URL", "")
        if not url:
            self.stdout.write("REDIS_URL is not set; skipping Redis wait.")
            return

        timeout = max(1, options["timeout"])
        interval = max(0.2, options["interval"])
        deadline = time.monotonic() + timeout
        last_error = None

        import redis

        while time.monotonic() < deadline:
            client = None
            try:
                client = redis.from_url(url, socket_connect_timeout=2, socket_timeout=2)
                if client.ping():
                    self.stdout.write(self.style.SUCCESS("Redis is ready."))
                    return
            except Exception as exc:
                last_error = exc
                remaining = max(0, int(deadline - time.monotonic()))
                self.stdout.write(f"Redis unavailable ({remaining}s left), retrying...")
                time.sleep(interval)
            finally:
                if client is not None:
                    try:
                        client.close()
                    except Exception:
                        pass

        raise CommandError(f"Redis not ready after {timeout}s: {last_error}")
