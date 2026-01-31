import time

from django.core.management.base import BaseCommand, CommandError
from django.db import connections
from django.db.utils import OperationalError


class Command(BaseCommand):
    help = "Block until the default database accepts connections."

    def add_arguments(self, parser):
        parser.add_argument(
            "--timeout",
            type=int,
            default=60,
            help="Seconds to wait before failing (default: 60).",
        )
        parser.add_argument(
            "--interval",
            type=float,
            default=1.0,
            help="Seconds between attempts (default: 1).",
        )

    def handle(self, *args, **options):
        timeout = max(1, options["timeout"])
        interval = max(0.2, options["interval"])
        deadline = time.monotonic() + timeout
        last_error = None

        while time.monotonic() < deadline:
            conn = connections["default"]
            try:
                conn.close_if_unusable_or_obsolete()
                conn.ensure_connection()
            except OperationalError as exc:
                last_error = exc
                remaining = max(0, int(deadline - time.monotonic()))
                self.stdout.write(f"Database unavailable ({remaining}s left), retrying...")
                time.sleep(interval)
                continue

            conn.close()
            self.stdout.write(self.style.SUCCESS("Database is ready."))
            return

        raise CommandError(f"Database not ready after {timeout}s: {last_error}")
