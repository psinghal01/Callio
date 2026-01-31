FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    DJANGO_SETTINGS_MODULE=main.settings \
    RUNNING_IN_DOCKER=true

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip install --upgrade pip \
    && pip install -r requirements.txt

COPY entrypoint.sh /app/entrypoint.sh
COPY . /app

RUN chmod +x /app/entrypoint.sh \
    && adduser --disabled-password --gecos "" --uid 1000 appuser \
    && mkdir -p /app/main/staticfiles \
    && chown -R appuser:appuser /app

USER appuser

WORKDIR /app/main

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
