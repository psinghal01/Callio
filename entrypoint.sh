#!/bin/sh
set -eu

cd /app/main

echo "Waiting for database..."
python manage.py wait_for_db --timeout "${DB_WAIT_TIMEOUT:-60}"

echo "Creating migrations if models changed..."
python manage.py makemigrations --noinput

echo "Applying migrations..."
python manage.py migrate --noinput

echo "Collecting static files..."
python manage.py collectstatic --noinput --clear

echo "Starting Daphne on 0.0.0.0:8000..."
exec daphne \
    --bind 0.0.0.0 \
    --port 8000 \
    --verbosity 1 \
    --proxy-headers \
    main.asgi:application
