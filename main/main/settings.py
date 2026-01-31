from pathlib import Path
import sys

import environ
from django.core.exceptions import ImproperlyConfigured

BASE_DIR = Path(__file__).resolve().parent.parent
REPO_ROOT = BASE_DIR.parent

env = environ.Env()

for env_path in (REPO_ROOT / ".env", BASE_DIR / ".env"):
    if env_path.is_file():
        env.read_env(str(env_path), overwrite=False)
        break


def _csv(name, default=""):
    raw = env(name, default=default)
    if raw is None:
        return []
    if isinstance(raw, (list, tuple)):
        return [str(item).strip() for item in raw if str(item).strip()]
    return [part.strip() for part in str(raw).split(",") if part.strip()]


def _in_docker():
    return Path("/.dockerenv").exists() or env.bool("RUNNING_IN_DOCKER", default=False)


DEBUG = env.bool("DEBUG", default=False)
SECRET_KEY = env("SECRET_KEY", default="")

if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "django-insecure-dev-only-not-for-production"
    else:
        raise ImproperlyConfigured("SECRET_KEY must be set when DEBUG is False.")

if not DEBUG and SECRET_KEY.startswith("django-insecure"):
    raise ImproperlyConfigured("Refusing to start with an insecure SECRET_KEY when DEBUG is False.")

ALLOWED_HOSTS = _csv("ALLOWED_HOSTS")
if not ALLOWED_HOSTS:
    if DEBUG:
        ALLOWED_HOSTS = ["localhost", "127.0.0.1", "[::1]"]
    else:
        raise ImproperlyConfigured("ALLOWED_HOSTS must be set when DEBUG is False.")

CSRF_TRUSTED_ORIGINS = _csv("CSRF_TRUSTED_ORIGINS")
if not CSRF_TRUSTED_ORIGINS and DEBUG:
    CSRF_TRUSTED_ORIGINS = [
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ]

INSTALLED_APPS = [
    "daphne",
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "channels",
    "chat",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "main.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

WSGI_APPLICATION = "main.wsgi.application"
ASGI_APPLICATION = "main.asgi.application"


def _build_database():
    if env.bool("USE_SQLITE", default=False):
        return {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }

    database_url = env("DATABASE_URL", default="").strip()
    if database_url:
        config = env.db("DATABASE_URL")
        config.setdefault("CONN_MAX_AGE", env.int("DB_CONN_MAX_AGE", default=60))
        config.setdefault("CONN_HEALTH_CHECKS", True)
        return config

    postgres_host = env("POSTGRES_HOST", default="").strip()
    if postgres_host == "db" and not _in_docker():
        sys.stderr.write(
            "WARNING: POSTGRES_HOST=db only resolves inside Docker Compose. "
            "Falling back to SQLite. Set POSTGRES_HOST=localhost to use a local Postgres, "
            "or USE_SQLITE=true to hide this warning.\n"
        )
        postgres_host = ""

    if not postgres_host:
        return {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }

    required = ("POSTGRES_DB", "POSTGRES_USER", "POSTGRES_PASSWORD")
    missing = [key for key in required if not env(key, default="")]
    if missing:
        raise ImproperlyConfigured(
            "Postgres is configured but missing env vars: " + ", ".join(missing)
        )

    options = {"connect_timeout": env.int("POSTGRES_CONNECT_TIMEOUT", default=10)}
    if env.bool("POSTGRES_SSL", default=False):
        options["sslmode"] = env("POSTGRES_SSLMODE", default="require")

    return {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": env("POSTGRES_DB"),
        "USER": env("POSTGRES_USER"),
        "PASSWORD": env("POSTGRES_PASSWORD"),
        "HOST": postgres_host,
        "PORT": env("POSTGRES_PORT", default="5432"),
        "CONN_MAX_AGE": env.int("DB_CONN_MAX_AGE", default=60),
        "CONN_HEALTH_CHECKS": True,
        "OPTIONS": options,
    }


DATABASES = {"default": _build_database()}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = env("TZ", default="UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
_static_dir = BASE_DIR / "static"
STATICFILES_DIRS = [_static_dir] if _static_dir.is_dir() else []

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedStaticFilesStorage",
    },
}

# Serve files from STATICFILES_DIRS when collectstatic has not run (local DEBUG).
WHITENOISE_USE_FINDERS = DEBUG
WHITENOISE_AUTOREFRESH = DEBUG
WHITENOISE_MAX_AGE = 0 if DEBUG else 60 * 60 * 24 * 30

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

REDIS_URL = env("REDIS_URL", default="").strip()
if REDIS_URL.startswith("redis://redis") and not _in_docker():
    sys.stderr.write(
        "WARNING: REDIS_URL points at the Compose service name. "
        "Falling back to in-memory rooms. Use redis://127.0.0.1:6379/0 for a local Redis.\n"
    )
    REDIS_URL = ""

ROOM_MAX_PARTICIPANTS = min(env.int("ROOM_MAX_PARTICIPANTS", default=20), 20)
ROOM_TTL_SECONDS = env.int("ROOM_TTL_SECONDS", default=86400)
ROOM_EMPTY_TTL_SECONDS = env.int("ROOM_EMPTY_TTL_SECONDS", default=86400)
ROOM_CODE_LENGTH = env.int("ROOM_CODE_LENGTH", default=6)

if REDIS_URL:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {
                "hosts": [REDIS_URL],
                "capacity": 1500,
                "expiry": 20,
            },
        }
    }
else:
    CHANNEL_LAYERS = {
        "default": {
            "BACKEND": "channels.layers.InMemoryChannelLayer",
        }
    }

SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
USE_X_FORWARDED_HOST = env.bool("USE_X_FORWARDED_HOST", default=True)
SESSION_COOKIE_SECURE = env.bool("SESSION_COOKIE_SECURE", default=not DEBUG)
CSRF_COOKIE_SECURE = env.bool("CSRF_COOKIE_SECURE", default=not DEBUG)
SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = True
SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = "DENY"

if not DEBUG:
    SECURE_HSTS_SECONDS = env.int("SECURE_HSTS_SECONDS", default=0)
    SECURE_SSL_REDIRECT = env.bool("SECURE_SSL_REDIRECT", default=False)
