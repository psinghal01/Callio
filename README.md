# Django WebRTC Video & Live Chat

A real-time video conferencing and live chat application built with **Django**, **Django Channels**, **WebSockets**, and **WebRTC**.

Designed for low-latency browser-to-browser communication — users → rooms → signaling → WebRTC media → live chat.

---

## Tech Stack

`Django : Django REST Framework : Django Channels : WebSockets : WebRTC : Redis : PostgreSQL : HTML : CSS : JavaScript : STUN/TURN : Docker : Docker Compose`

---

## Core Functionality

### Video Calls

Real-Time Video Calling · Audio Streaming · Browser-to-Browser Media Transfer · Multi-User Rooms

### Live Chat

Real-Time Text Chat · WebSocket Messaging · Room-Based Communication

### WebRTC Signaling

SDP Offer/Answer Exchange · ICE Candidate Exchange · Peer Discovery · WebSocket-Based Signaling

### Rooms

Create Rooms · Join via Room Code · Host Management · Participant Admission · Open-for-All Mode · Maximum 20 Participants

### Network Connectivity

STUN/TURN Support · NAT Traversal · Public IP Discovery · UDP-Based Low-Latency Communication

### Real-Time Architecture

Django Channels · WebSocket Connections · Redis Channel Layer · Asynchronous Communication

### Room Management

Redis-Based Room State · Automatic Room Expiration · TTL Support · Empty Room Cleanup

### Health Monitoring

Application Health Check · `/healthz/` Endpoint

---

## Architecture

```text
USER A                  DJANGO + CHANNELS                  USER B
Browser                       Server                     Browser
   │                              │                          │
   │──── WebSocket Connect ──────>│                          │
   │                              │<──── WebSocket Connect ──│
   │                              │                          │
   │──── SDP Offer ──────────────>│                          │
   │                              │──── Forward Offer ──────>│
   │                              │                          │
   │<──── Forward Answer ────────│<──── SDP Answer ─────────│
   │                              │                          │
   │──── ICE Candidates ─────────>│<──── ICE Candidates ─────│
   │                              │                          │
   │<========== WebRTC Connection Established =============>│
   │                              │                          │
   │<────── Direct Audio / Video Streaming ────────────────>│
```

**Django acts as the signaling server.**

After the WebRTC connection is established, audio and video are transmitted directly between browsers whenever the network topology allows it. Django is not responsible for transferring the media stream.

---

## WebRTC Flow

```text
User joins room
      ↓
WebSocket connection
      ↓
Peer discovery
      ↓
SDP Offer / Answer
      ↓
ICE Candidate Exchange
      ↓
STUN / TURN
      ↓
WebRTC Connection
      ↓
Direct Audio + Video
```

---

## Structure

```text
Callio/
├── Dockerfile
├── docker-compose.yml
├── .env.example
├── requirements.txt
├── README.md
│
├── main/
│   ├── manage.py
│   │
│   ├── main/
│   │   ├── settings.py
│   │   ├── urls.py
│   │   ├── asgi.py
│   │   └── routing.py
│   │
│   ├── chat/
│   ├── call/
│   └── templates/
│
└── ...
```

---

## Setup (Local)

```bash
git clone <your-repository-url>
cd <project-folder-name>

python3 -m venv venv
source venv/bin/activate

pip install -r requirements.txt

cp .env.example .env
```

For a local non-Docker setup, use SQLite:

```env
USE_SQLITE=true
```

Or configure PostgreSQL using a running local PostgreSQL instance.

Run the server:

```bash
python manage.py runserver
```

App → `http://127.0.0.1:8000/`

Open the application in **two browsers/tabs**, join the same room, and allow camera and microphone permissions.

---

## Setup (Docker)

```bash
cp .env.example .env

docker compose up --build
```

App → `http://127.0.0.1:8000/`

Health Check → `http://127.0.0.1:8000/healthz/`

Compose also starts a local **coturn** STUN/TURN server on port `3478`. The web app does not wait on it; calls still start if TURN is down (host-only ICE).

---

## STUN / TURN (ICE)

Browsers need a reachable STUN/TURN host. Never point ICE URLs at the Compose service name `coturn` — that hostname only exists on the Docker network, not in the browser.

| Setup | What to set |
| --- | --- |
| Two tabs on this machine | Defaults: `ICE_*` and `ICE_EXTERNAL_IP=127.0.0.1` |
| Phone on the same Wi-Fi | Add the PC LAN IP to `ALLOWED_HOSTS` and `CSRF_TRUSTED_ORIGINS`. Set `ICE_HOST` and `ICE_EXTERNAL_IP` to that LAN IP. Open the app via `http://<lan-ip>:8000/` |
| Friend on the public internet | Run coturn on a public VPS (or a hosted TURN). Set `ICE_STUN_URLS` / `ICE_TURN_URLS` to that public host. Local Docker coturn cannot be reached from 4G. |
| Disable ICE servers | `ICE_ENABLED=false` (same-machine host candidates only) |

After changing ICE env vars, recreate the stack so Django and coturn both pick them up:

```bash
docker compose up --build
```

In Chrome, `chrome://webrtc-internals` should list your `iceServers`. Same-LAN or NAT-restricted paths may show `srflx` / `relay` candidates. A remote peer still cannot use `127.0.0.1` TURN.

Stop:

```bash
docker compose down
```

PostgreSQL data is stored in the `postgres_data` Docker volume.

To remove the database volume:

```bash
docker compose down -v
```

---

## Environment Variables

Create `.env` using `.env.example`.

For Docker Compose, PostgreSQL should use the Compose service hostname:

```env
POSTGRES_HOST=db
```

For a local PostgreSQL installation:

```env
POSTGRES_HOST=localhost
```

---

## Requirements

* Camera and microphone permissions must be enabled.
* Use a modern browser such as **Chrome, Firefox, or Edge**.
* WebRTC uses **UDP** where possible for low-latency media communication.
* STUN/TURN servers may be required for reliable connectivity across restrictive NATs or firewalls.
* Django/WebSockets handle **signaling**, while WebRTC handles the actual audio/video communication.

---

Built as a real-time communication system demonstrating **WebRTC, WebSockets, Django Channels, Redis, and browser-to-browser media streaming**.