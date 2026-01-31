# Callio

Browser video calls with in-call chat. Django + Channels handle rooms and signaling. WebRTC carries camera, mic, and chat. Media does not go through the server.

**Stack:** Django, Daphne, Channels, Redis, PostgreSQL, WebRTC, coturn, Docker Compose.

## Features

- Unlisted rooms (code or copy-link); first joiner is host
- Waiting room with admit/deny, or Open for all (cap 20)
- Same display name is one seat — second tab can take over
- Mesh video/audio; mic and camera start off
- Letter avatar when camera is off; mic icon on tiles
- Pin a tile; people drawer (in call + waiting)
- In-call chat on the data channel: timestamps, emoji, unread badge
- Private message from the people list (data channel to that person only)
- Join/leave toasts; host handoff if the host leaves
- Solo idle: leave after 2 minutes alone (link still works)
- STUN/TURN (coturn); Redis room state (~24h); `/healthz/`

## How it works

1. Create an unlisted room (code/link only). First joiner is the host.
2. Others wait unless **Open for all** is on (max 20). Same display name is one seat and can take over.
3. Admitted clients open a WebSocket. Existing peers send an SDP offer; the new peer answers. ICE candidates trickle on the same socket.
4. Browsers connect peer-to-peer (or via TURN). Mic and camera start **off**.
5. Chat and cam/mic state use the WebRTC data channel, not the socket. Nothing is stored.

Rooms live in Redis (~24h TTL). Postgres is for Django only. `GET /healthz/` checks the database and Redis.

```text
Browser ── WebSocket (join, admit, offer/answer, ICE) ── Django / Redis
Browser ══ WebRTC (audio, video, chat) ══ Browser
```

## Setup

```bash
cp .env.example .env
docker compose up --build
```
You can access app on these links

App: [http://127.0.0.1:8000/](http://127.0.0.1:8000/)  
Health: [http://127.0.0.1:8000/healthz/](http://127.0.0.1:8000/healthz/)

Compose starts web, Postgres, Redis, and coturn (`3478`). The web app does not wait on coturn.

Chrome, Firefox, or Edge. Allow camera and microphone. Open two tabs (or a phone on the same Wi‑Fi) and join the same room.

Camera and microphone need a secure context. Use HTTPS, or on Chrome Android add the LAN URL under `chrome://flags` → Insecure origins treated as secure.

```bash
docker compose down      # stop
docker compose down -v   # also drop the db volume
```

## ICE (STUN / TURN)

Point browsers at a host they can reach. Never use the Compose name `coturn`. After changing ICE env, run `docker compose up --build` again.

| Where you test | Set |
| --- | --- |
| Two tabs on this machine | Defaults (`ICE_EXTERNAL_IP=127.0.0.1`) |
| Phone on the same Wi‑Fi | LAN IP in `ALLOWED_HOSTS`, `CSRF_TRUSTED_ORIGINS`, `ICE_HOST`, `ICE_EXTERNAL_IP`. Open `http://<lan-ip>:8000/` |
| Public internet | Hosted or VPS TURN. Local coturn is not reachable from 4G. |
| ICE off | `ICE_ENABLED=false` (host candidates only) |
