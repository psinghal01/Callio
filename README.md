# 🎥 Django WebRTC Video & Live Chat Application

A real-time **Video Chat + Live Text Chat** application built using **Django**, **Django Channels**, **WebSockets (for signaling)**, and **WebRTC (Web Real-Time Communication)**.

This project demonstrates how browsers establish a **direct connection** for audio/video while using Django only as a **signaling server**.

---

## 🧠 Architecture Overview

* **Django + Channels** → Signaling server
* **WebSocket** → Exchange metadata (SDP, ICE candidates)
* **WebRTC** → Direct browser-to-browser media streaming
* **STUN/TURN servers** → NAT traversal & public IP discovery

> ⚠️ Important:
> WebRTC works over **UDP**, which means:
>
> * No guaranteed packet delivery
> * Lower latency than TCP
> * Some packets may be lost (acceptable for video/audio)

---
## 📡 Signaling Flow Diagram

```
ALICE'S BROWSER          DJANGO SERVER         BOB'S BROWSER
     |                        |                       |
     |--[WebSocket Connect]-->|                       |
     |<------[Accept]---------+                       |
     |                        |                       |
     |--[new-peer: Alice]---->|                       |
     |                        |                       |
     |                        |<--[WebSocket Connect]-|
     |                        +--------[Accept]------>|
     |                        |                       |
     |                        |<--[new-peer: Bob]-----+
     |<--[Broadcast Bob]------+                       |
     |                        +-------[Broadcast]---->|
     |                        |                       |
     |--[new-offer]---------->|                       |
     |                        +----[Forward Offer]--->|
     |                        |                       |
     |                        |<--[new-answer]--------+
     |<---[Forward Answer]----+                       |
     |                        |                       |
     |<===== WebRTC Connection Established ==========>|
     |                        |                       |
     | Video/Audio flows directly between browsers    |
     | Server is no longer involved!                  |
```

---
## 🛠️ Tech Stack

* **Backend**: Django, Django Channels
* **Protocol**: WebSocket
* **Real-Time Media**: WebRTC
* **Frontend**: HTML, CSS, JavaScript

---

## ▶️ How to Run (Docker — recommended)

Requires Docker and Docker Compose. From the `Callio` folder:

```bash
cp .env.example .env   # already present if you cloned this setup
docker compose up --build
```

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) in two tabs, join with different usernames, allow camera/mic.

Health check: [http://127.0.0.1:8000/healthz/](http://127.0.0.1:8000/healthz/)

Stop:

```bash
docker compose down
```

Postgres data lives in the `postgres_data` volume. `docker compose down -v` deletes it.

---

## ▶️ How to Run This Project Locally (no Docker)

Follow the steps below to set up and run the application on your local machine.

---

### 1️⃣ Clone the Repository

```bash
git clone <your-repository-url>
```

Move into the project directory:

```bash
cd <project-folder-name>
```

---

### 2️⃣ Create a Virtual Environment

#### On Windows

```bash
python -m venv venv
```

Activate it:

```bash
venv\Scripts\activate
```

#### On macOS / Linux

```bash
python3 -m venv venv
```

Activate it:

```bash
source venv/bin/activate
```

You should now see `(venv)` in your terminal.

---

### 3️⃣ Install Dependencies

Once the virtual environment is activated, install all required packages using:

```bash
pip install -r requirements.txt
```

Copy `.env.example` to `.env`. For a no-Docker run, set `USE_SQLITE=true` **or** point `POSTGRES_HOST` at a running Postgres (`localhost`). Leave `POSTGRES_HOST=db` only when using Compose.

---

### 4️⃣ Run the Django Server

Make sure you are in the **main folder** (where `manage.py` exists), then run:

```bash
python manage.py runserver
```

---

### 5️⃣ Open the App in Browser

Open your browser and go to:

```
http://127.0.0.1:8000/
```

* Open the same URL in **two different tabs or browsers**
* Enter different usernames
* Allow camera & microphone access
* Start video and live chat 🎥💬

---

## ⚠️ Important Notes

* Camera & microphone permissions **must be allowed**
* WebRTC works best on:
  * Chrome
  * Firefox
  * Edge
* Server is used **only for signaling**, not media transfer

---