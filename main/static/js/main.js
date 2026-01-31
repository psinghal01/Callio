(function () {
    var configEl = document.getElementById("room-config");
    if (!configEl) {
        return;
    }

    var roomConfig = {};
    try {
        roomConfig = JSON.parse(configEl.textContent);
    } catch (err) {
        return;
    }

    if (!roomConfig.exists) {
        return;
    }

    var mapPeers = {};
    var username = "";
    var isHost = false;
    var inCall = false;
    var sessionDead = false;
    var webSocket = null;
    var localStream = new MediaStream();
    var mediaReady = null;
    var mediaControlsBound = false;
    var audioOn = false;
    var videoOn = false;
    var unreadChat = 0;
    var recentlyReplaced = {};
    var knownWaiters = {};
    var waitersPrimed = false;
    var notifyCtx = null;
    var lastNotifyAt = 0;
    var pinnedPeer = "";
    var LOCAL_PEER = "__local__";
    var remoteVideoDesired = {};
    var boundDataChannels = typeof WeakSet === "function" ? new WeakSet() : null;
    var MEDIA_PREFIX = "__CALLIO__/v1 ";

    var usernameInput = document.querySelector("#username");
    var btnJoin = document.querySelector("#btn-join");
    var joinPanel = document.querySelector("#join-panel");
    var joinError = document.querySelector("#join-error");
    var waitingPanel = document.querySelector("#waiting-panel");
    var blockedPanel = document.querySelector("#blocked-panel");
    var blockedTitle = document.querySelector("#blocked-title");
    var blockedCopy = document.querySelector("#blocked-copy");
    var btnReuseTab = document.querySelector("#btn-reuse-tab");
    var callLayout = document.querySelector("#call-layout");
    var callBar = document.querySelector("#call-bar");
    var videoGrid = document.querySelector("#video-grid");
    var settingsDrawer = document.querySelector("#drawer-settings");
    var chatDrawer = document.querySelector("#drawer-chat");
    var peopleDrawer = document.querySelector("#drawer-people");
    var btnSettings = document.querySelector("#btn-settings");
    var btnChat = document.querySelector("#btn-chat");
    var btnPeople = document.querySelector("#btn-people");
    var btnLeave = document.querySelector("#btn-leave");
    var openForAllInput = document.querySelector("#open-for-all");
    var waitingList = document.querySelector("#waiting-list");
    var admittedList = document.querySelector("#admitted-list");
    var waitingEmpty = document.querySelector("#waiting-empty");
    var waitingBadge = document.querySelector("#waiting-badge");
    var chatBadge = document.querySelector("#chat-badge");
    var roomCount = document.querySelector("#room-count");
    var btnCopyLink = document.querySelector("#btn-copy-link");
    var toastEl = document.querySelector("#toast");
    var localTile = document.querySelector("#local-tile");
    var localVideo = document.querySelector("#local-video");
    var localName = document.querySelector("#local-name");
    var localLetter = document.querySelector("#local-letter");
    var btnToggleAudio = document.querySelector("#btn-toggle-audio");
    var btnToggleVideo = document.querySelector("#btn-toggle-video");
    var btnSendMsg = document.querySelector("#btn-send-msg");
    var messageList = document.querySelector("#message-list");
    var messageInput = document.querySelector("#msg");
    var nameTakenModal = document.querySelector("#name-taken-modal");
    var nameTakenInput = document.querySelector("#name-taken-input");
    var nameTakenError = document.querySelector("#name-taken-error");
    var btnNameChange = document.querySelector("#btn-name-change");
    var btnNameTakeover = document.querySelector("#btn-name-takeover");
    var joinReplace = false;
    var takenName = "";
    var soloIdleModal = document.querySelector("#solo-idle-modal");
    var soloIdleCountdown = document.querySelector("#solo-idle-countdown");
    var btnSoloStay = document.querySelector("#btn-solo-stay");
    var btnSoloLeave = document.querySelector("#btn-solo-leave");
    var admittedInCall = 0;
    var soloDeadline = 0;
    var soloTimer = null;
    var soloWarned = false;
    var SOLO_IDLE_MS = 2 * 60 * 1000;
    var SOLO_WARN_MS = 30 * 1000;

    var ROOM_ACTIONS = {
        "join-result": true,
        error: true,
        "waiting-update": true,
        admitted: true,
        denied: true,
        replaced: true,
        settings: true,
        "host-changed": true,
        "peer-left": true,
        "room-closed": true,
    };

    function showToast(text, options) {
        if (!toastEl) {
            return;
        }
        options = options || {};
        toastEl.textContent = text || "";
        toastEl.hidden = !text;
        toastEl.classList.toggle("toast-chat", !!options.chat);
        toastEl.classList.toggle("toast-people", !!options.people);
        toastEl.dataset.chat = options.chat ? "1" : "";
        toastEl.dataset.people = options.people ? "1" : "";
        if (text) {
            if (options.sound) {
                playNotify(options.sound);
            }
            window.clearTimeout(showToast._t);
            showToast._t = window.setTimeout(function () {
                toastEl.hidden = true;
                toastEl.classList.remove("toast-chat", "toast-people");
                toastEl.dataset.chat = "";
                toastEl.dataset.people = "";
            }, options.chat || options.people ? 4200 : 3200);
        }
    }

    function unlockNotifySound() {
        try {
            var Ctx = window.AudioContext || window.webkitAudioContext;
            if (!Ctx) {
                return;
            }
            if (!notifyCtx) {
                notifyCtx = new Ctx();
            }
            if (notifyCtx.state === "suspended") {
                notifyCtx.resume().catch(function () {});
            }
        } catch (err) {}
    }

    function playNotify(kind) {
        if (sessionDead) {
            return;
        }
        unlockNotifySound();
        if (!notifyCtx || notifyCtx.state !== "running") {
            return;
        }
        var now = Date.now();
        if (now - lastNotifyAt < 200) {
            return;
        }
        lastNotifyAt = now;
        var tones = {
            chat: [880],
            join: [660, 880],
            leave: [520, 390],
            wait: [740, 990],
        };
        var freqs = tones[kind] || [700];
        var t0 = notifyCtx.currentTime;
        freqs.forEach(function (freq, index) {
            try {
                var osc = notifyCtx.createOscillator();
                var gain = notifyCtx.createGain();
                var start = t0 + index * 0.09;
                osc.type = "sine";
                osc.frequency.setValueAtTime(freq, start);
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.exponentialRampToValueAtTime(0.055, start + 0.015);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.14);
                osc.connect(gain);
                gain.connect(notifyCtx.destination);
                osc.start(start);
                osc.stop(start + 0.16);
            } catch (err) {}
        });
    }

    function dismissTypedToast(type) {
        if (!toastEl || toastEl.dataset[type] !== "1") {
            return;
        }
        toastEl.hidden = true;
        toastEl.classList.remove("toast-chat", "toast-people");
        toastEl.dataset.chat = "";
        toastEl.dataset.people = "";
    }

    function isPeopleOpen() {
        return !!(peopleDrawer && !peopleDrawer.hidden);
    }

    function setJoinError(text) {
        if (!joinError) {
            return;
        }
        joinError.textContent = text || "";
        joinError.hidden = !text;
    }

    function setNameTakenError(text) {
        if (!nameTakenError) {
            return;
        }
        nameTakenError.textContent = text || "";
        nameTakenError.hidden = !text;
    }

    function unlockJoinForm() {
        if (usernameInput) {
            usernameInput.disabled = false;
        }
        if (btnJoin) {
            btnJoin.disabled = false;
        }
    }

    function formatSoloClock(ms) {
        var total = Math.max(0, Math.ceil(ms / 1000));
        var mins = Math.floor(total / 60);
        var secs = total % 60;
        return mins + ":" + (secs < 10 ? "0" : "") + secs;
    }

    function hideSoloIdleModal() {
        if (soloIdleModal) {
            soloIdleModal.hidden = true;
        }
    }

    function showSoloIdleModal(msLeft) {
        if (soloIdleCountdown) {
            soloIdleCountdown.textContent = formatSoloClock(msLeft);
        }
        if (soloIdleModal && soloIdleModal.hidden) {
            soloIdleModal.hidden = false;
            playNotify("wait");
        } else if (soloIdleCountdown) {
            soloIdleCountdown.textContent = formatSoloClock(msLeft);
        }
    }

    function clearSoloIdle(resetDeadline) {
        if (soloTimer) {
            window.clearInterval(soloTimer);
            soloTimer = null;
        }
        hideSoloIdleModal();
        if (resetDeadline) {
            soloDeadline = 0;
            soloWarned = false;
        }
    }

    function endSoloIdleCall() {
        clearSoloIdle(true);
        if (sessionDead || !inCall) {
            return;
        }
        endSession({
            panel: "blocked",
            hideReuse: true,
            title: "No one else joined",
            copy: "This call ended because you were alone. The meeting link still works if you want to come back.",
        });
    }

    function tickSoloIdle() {
        if (!inCall || sessionDead || admittedInCall >= 2) {
            clearSoloIdle(true);
            return;
        }
        if (!soloDeadline) {
            return;
        }
        var left = soloDeadline - Date.now();
        if (left <= 0) {
            endSoloIdleCall();
            return;
        }
        if (left <= SOLO_WARN_MS) {
            showSoloIdleModal(left);
            soloWarned = true;
        } else if (soloWarned) {
            hideSoloIdleModal();
        }
    }

    function syncSoloIdle() {
        if (!inCall || sessionDead) {
            clearSoloIdle(true);
            return;
        }
        if (admittedInCall >= 2) {
            clearSoloIdle(true);
            return;
        }
        if (admittedInCall < 1) {
            admittedInCall = 1;
        }
        if (!soloDeadline) {
            soloDeadline = Date.now() + SOLO_IDLE_MS;
            soloWarned = false;
        }
        tickSoloIdle();
        if (!soloTimer) {
            soloTimer = window.setInterval(tickSoloIdle, 250);
        }
    }

    function hideNameTakenModal() {
        if (nameTakenModal) {
            nameTakenModal.hidden = true;
        }
        setNameTakenError("");
    }

    function showNameTakenModal(current) {
        takenName = current || username || "";
        if (nameTakenInput) {
            nameTakenInput.value = "";
            nameTakenInput.placeholder = takenName ? ("Not “" + takenName + "”") : "Choose a different name";
        }
        setNameTakenError("");
        if (nameTakenModal) {
            nameTakenModal.hidden = false;
        }
        unlockJoinForm();
        if (nameTakenInput) {
            nameTakenInput.focus();
        }
    }

    function canJoinOverSocket() {
        return !!(webSocket && webSocket.readyState === WebSocket.OPEN && !sessionDead && !inCall);
    }

    function sendJoin() {
        sendRaw({
            action: "join",
            username: username,
            replace: !!joinReplace,
        });
    }

    function wsUrl() {
        var protocol = window.location.protocol === "https:" ? "wss://" : "ws://";
        return protocol + window.location.host + "/ws/room/" + roomConfig.code + "/";
    }

    function sendRaw(payload) {
        if (!webSocket || webSocket.readyState !== WebSocket.OPEN || sessionDead) {
            return;
        }
        webSocket.send(JSON.stringify(payload));
    }

    function sendSignal(action, message) {
        sendRaw({
            peer: username,
            action: action,
            message: message || {},
        });
    }

    function nameKey(name) {
        return String(name || "").trim().toLowerCase();
    }

    function sameName(a, b) {
        var left = nameKey(a);
        var right = nameKey(b);
        return !!left && left === right;
    }

    function resolvePeerKey(name) {
        var wanted = nameKey(name);
        if (!wanted) {
            return name;
        }
        var keys = Object.keys(mapPeers);
        for (var i = 0; i < keys.length; i++) {
            if (nameKey(keys[i]) === wanted) {
                return keys[i];
            }
        }
        return name;
    }

    function isCurrentPeer(peer, peerUsername) {
        var key = resolvePeerKey(peerUsername);
        return !!(peer && mapPeers[key] && mapPeers[key][0] === peer);
    }

    function markPeerReplaced(name) {
        var key = nameKey(name);
        if (!key) {
            return;
        }
        recentlyReplaced[key] = Date.now();
        window.setTimeout(function () {
            if (recentlyReplaced[key] && Date.now() - recentlyReplaced[key] >= 8000) {
                delete recentlyReplaced[key];
            }
        }, 8000);
    }

    function consumePeerReplaced(name) {
        var key = nameKey(name);
        var at = recentlyReplaced[key];
        delete recentlyReplaced[key];
        return !!(at && Date.now() - at < 8000);
    }

    function announcePresence(name, kind) {
        if (!inCall || sessionDead || !name || sameName(name, username)) {
            return;
        }
        var label = clipToast(String(name).trim(), 32);
        if (!label) {
            return;
        }
        if (kind === "join") {
            showToast(label + " joined", { sound: "join" });
        } else if (kind === "leave") {
            showToast(label + " left", { sound: "leave" });
        }
    }

    function localCameraOn() {
        return !!(videoOn && localStream && localStream.getVideoTracks()[0]);
    }

    function mediaPayload() {
        return MEDIA_PREFIX + JSON.stringify({ t: "media", video: localCameraOn() });
    }

    function sendMediaStateTo(channel) {
        if (!channel || channel.readyState !== "open") {
            return;
        }
        try {
            channel.send(mediaPayload());
        } catch (err) {}
    }

    function broadcastMediaState() {
        getDataChannels().forEach(sendMediaStateTo);
    }

    function parseMediaSignal(raw) {
        if (typeof raw !== "string" || raw.indexOf(MEDIA_PREFIX) !== 0) {
            return null;
        }
        try {
            var data = JSON.parse(raw.slice(MEDIA_PREFIX.length));
            if (!data || data.t !== "media") {
                return null;
            }
            return data;
        } catch (err) {
            return null;
        }
    }

    function tileForPeer(peerUsername) {
        var video = document.getElementById(safeVideoId(peerUsername));
        if (!video) {
            return null;
        }
        return video.closest ? video.closest(".tile") : video.parentNode;
    }

    function applyRemoteMedia(peerUsername, data) {
        if (!peerUsername) {
            return;
        }
        remoteVideoDesired[peerUsername] = !!data.video;
        var tile = tileForPeer(peerUsername);
        if (!tile) {
            return;
        }
        if (!data.video) {
            setTileVideoOff(tile, true);
            return;
        }
        var video = document.getElementById(safeVideoId(peerUsername));
        var hasFrames = video && video.videoWidth > 1 && video.videoHeight > 1;
        setTileVideoOff(tile, !hasFrames);
    }

    function bindDataChannel(channel, peerUsername) {
        if (!channel) {
            return;
        }
        if (boundDataChannels) {
            if (boundDataChannels.has(channel)) {
                return;
            }
            boundDataChannels.add(channel);
        } else if (channel._callioBound) {
            return;
        } else {
            channel._callioBound = true;
        }
        channel.addEventListener("open", function () {
            sendMediaStateTo(channel);
        });
        channel.addEventListener("message", function (event) {
            var media = parseMediaSignal(event.data);
            if (media) {
                applyRemoteMedia(peerUsername, media);
                return;
            }
            dcOnMessage(event);
        });
        if (channel.readyState === "open") {
            sendMediaStateTo(channel);
        }
    }

    function setPanel(name) {
        if (joinPanel) {
            joinPanel.hidden = name !== "join";
        }
        if (waitingPanel) {
            waitingPanel.hidden = name !== "waiting";
        }
        if (blockedPanel) {
            blockedPanel.hidden = name !== "blocked";
        }
        if (callLayout) {
            callLayout.hidden = name !== "call";
        }
        if (callBar) {
            callBar.hidden = name !== "call";
        }
        if (name !== "join") {
            hideNameTakenModal();
        }
        if (name !== "call") {
            clearSoloIdle(true);
        }
    }

    function closeDrawers() {
        [chatDrawer, peopleDrawer, settingsDrawer].forEach(function (el) {
            if (el) {
                el.hidden = true;
            }
        });
        [btnChat, btnPeople, btnSettings].forEach(function (el) {
            if (el) {
                el.classList.remove("active");
            }
        });
        updateGridLayout();
    }

    function toggleDrawer(name) {
        var map = { chat: chatDrawer, people: peopleDrawer, settings: settingsDrawer };
        var buttons = { chat: btnChat, people: btnPeople, settings: btnSettings };
        var target = map[name];
        if (!target) {
            return;
        }
        var willOpen = target.hidden;
        closeDrawers();
        if (willOpen) {
            target.hidden = false;
            if (buttons[name]) {
                buttons[name].classList.add("active");
            }
            if (name === "chat") {
                resetChatUnread();
                scrollChatToEnd();
                dismissTypedToast("chat");
            }
            if (name === "people") {
                dismissTypedToast("people");
            }
        }
        updateGridLayout();
    }

    function stopLocalMedia() {
        if (localStream) {
            localStream.getTracks().forEach(function (track) {
                try {
                    track.stop();
                } catch (err) {}
            });
        }
        localStream = new MediaStream();
        mediaReady = null;
        if (localVideo) {
            localVideo.srcObject = null;
        }
        audioOn = false;
        videoOn = false;
        setTileVideoOff(localTile, true);
        syncMediaButtons();
    }

    function closeSocket() {
        if (!webSocket) {
            return;
        }
        var socket = webSocket;
        webSocket = null;
        try {
            socket.close();
        } catch (err) {}
    }

    function teardownPeers() {
        Object.keys(mapPeers).forEach(function (peerUsername) {
            cleanupPeer(peerUsername);
        });
        mapPeers = {};
    }

    function endSession(options) {
        options = options || {};
        sessionDead = true;
        inCall = false;
        pinnedPeer = "";
        recentlyReplaced = {};
        knownWaiters = {};
        waitersPrimed = false;
        admittedInCall = 0;
        clearSoloIdle(true);
        resetChatUnread();
        teardownPeers();
        stopLocalMedia();
        closeSocket();
        closeDrawers();
        updateGridLayout();
        setTileVideoOff(localTile, true);
        if (options.panel === "blocked") {
            if (blockedTitle) {
                blockedTitle.textContent = options.title || "You’re in this meeting in another tab";
            }
            if (blockedCopy) {
                blockedCopy.textContent = options.copy || "This tab was disconnected so only one session stays live.";
            }
            if (btnReuseTab) {
                btnReuseTab.hidden = !!options.hideReuse;
            }
            setPanel("blocked");
            return;
        }
        if (options.panel === "join") {
            setPanel("join");
            return;
        }
        setPanel("blocked");
    }

    function enterCall() {
        if (sessionDead) {
            return;
        }
        if (inCall) {
            applyHostUi();
            return;
        }
        inCall = true;
        if (localName) {
            localName.textContent = username || "You";
        }
        setTileLetter(localTile, username);
        setPanel("call");
        updateGridLayout();
        admittedInCall = Math.max(admittedInCall, 1);
        syncSoloIdle();
        ensureLocalMedia()
            .catch(function () {
                videoOn = false;
                setTileVideoOff(localTile, true);
                syncMediaButtons();
                broadcastMediaState();
                showToast("Camera or microphone is blocked. You can still stay in the call.");
            })
            .finally(function () {
                if (!sessionDead && inCall) {
                    sendSignal("new-peer", {});
                }
            });
    }

    function showWaiting() {
        setPanel("waiting");
    }

    function applyHostUi() {
        if (btnSettings) {
            btnSettings.hidden = !isHost;
        }
        if (!isHost && settingsDrawer) {
            settingsDrawer.hidden = true;
            if (btnSettings) {
                btnSettings.classList.remove("active");
            }
        }
    }

    function iconButton(className, label, pathD) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = className;
        btn.title = label;
        btn.setAttribute("aria-label", label);
        var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svg.setAttribute("viewBox", "0 0 24 24");
        svg.setAttribute("aria-hidden", "true");
        var path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("fill", "currentColor");
        path.setAttribute("d", pathD);
        svg.appendChild(path);
        btn.appendChild(svg);
        return btn;
    }

    function peopleName(text) {
        var name = document.createElement("span");
        name.className = "people-name";
        name.textContent = text;
        name.title = text;
        return name;
    }

    function syncWaiters(waiting, announce) {
        var next = {};
        var added = [];
        (waiting || []).forEach(function (person) {
            var display = person && person.username;
            var key = nameKey(display);
            if (!key) {
                return;
            }
            next[key] = display;
            if (announce && !knownWaiters[key] && !sameName(display, username)) {
                added.push(display);
            }
        });
        knownWaiters = next;
        return added;
    }

    function announceWaiters(names) {
        if (!isHost || !inCall || sessionDead || !names || !names.length) {
            return;
        }
        if (isPeopleOpen()) {
            return;
        }
        var label;
        if (names.length === 1) {
            label = clipToast(names[0], 32) + " is waiting to join";
        } else {
            label = names.length + " people are waiting to join";
        }
        showToast(label, { people: true, sound: "wait" });
    }

    function renderWaiting(room) {
        var waiting = (room && room.waiting) || [];
        var admitted = (room && room.admitted) || [];
        if (admittedList) {
            admittedList.innerHTML = "";
            admitted.forEach(function (person) {
                var li = document.createElement("li");
                li.appendChild(peopleName(person.username + (person.is_host ? " · host" : "")));
                admittedList.appendChild(li);
            });
        }
        if (waitingList) {
            waitingList.innerHTML = "";
            waiting.forEach(function (person) {
                var li = document.createElement("li");
                li.appendChild(peopleName(person.username));
                if (isHost) {
                    var actions = document.createElement("span");
                    actions.className = "people-actions";
                    var admit = iconButton(
                        "btn-admit",
                        "Admit " + person.username,
                        "M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"
                    );
                    admit.addEventListener("click", function () {
                        sendRaw({ action: "admit", username: person.username });
                    });
                    var deny = iconButton(
                        "btn-deny",
                        "Deny " + person.username,
                        "M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
                    );
                    deny.addEventListener("click", function () {
                        sendRaw({ action: "deny", username: person.username });
                    });
                    actions.appendChild(admit);
                    actions.appendChild(deny);
                    li.appendChild(actions);
                }
                waitingList.appendChild(li);
            });
        }
        if (waitingEmpty) {
            waitingEmpty.hidden = waiting.length > 0;
        }
        if (waitingBadge) {
            waitingBadge.textContent = String(waiting.length);
            waitingBadge.hidden = waiting.length === 0;
        }
        var admittedCount = room && typeof room.admitted_count === "number"
            ? room.admitted_count
            : admitted.length;
        admittedInCall = admittedCount;
        if (roomCount) {
            var max = (room && room.max) || roomConfig.maxParticipants || 20;
            roomCount.textContent = admittedCount + " / " + max;
            roomCount.hidden = false;
        }
        syncSoloIdle();
        if (openForAllInput && room && typeof room.open_for_all === "boolean") {
            openForAllInput.checked = room.open_for_all;
        }
        if (!waitersPrimed) {
            syncWaiters(waiting, false);
            waitersPrimed = true;
            return;
        }
        if (isHost && inCall && !sessionDead) {
            announceWaiters(syncWaiters(waiting, true));
        } else {
            syncWaiters(waiting, false);
        }
    }

    function handleRoomEvent(data) {
        var action = data.action;
        if (action === "join-result") {
            hideNameTakenModal();
            joinReplace = false;
            isHost = !!data.is_host;
            applyHostUi();
            renderWaiting(data.room);
            if (data.state === "admitted") {
                enterCall();
                if (isHost) {
                    announceWaiters(Object.keys(knownWaiters).map(function (key) {
                        return knownWaiters[key];
                    }).filter(function (name) {
                        return !sameName(name, username);
                    }));
                }
            } else {
                showWaiting();
            }
            return;
        }
        if (action === "admitted") {
            if (sessionDead) {
                return;
            }
            isHost = !!data.is_host;
            applyHostUi();
            renderWaiting(data.room);
            enterCall();
            return;
        }
        if (action === "denied") {
            endSession({
                panel: "blocked",
                title: "You weren’t admitted",
                copy: data.message || "The host declined your join request.",
                hideReuse: true,
            });
            return;
        }
        if (action === "replaced") {
            endSession({
                panel: "blocked",
                title: "You’re in this meeting in another tab",
                copy: "Video and mic on this tab were stopped. Continue here or go home.",
            });
            return;
        }
        if (action === "error") {
            unlockJoinForm();
            if (data.code === "name_taken") {
                showNameTakenModal(username);
                if (nameTakenModal && !nameTakenModal.hidden) {
                    setNameTakenError(data.message || "That name is already in this meeting.");
                } else {
                    setJoinError(data.message || "That name is already in this meeting.");
                }
                return;
            }
            if (nameTakenModal && !nameTakenModal.hidden) {
                setNameTakenError(data.message || "Something went wrong.");
            } else {
                setJoinError(data.message || "Something went wrong.");
            }
            showToast(data.message || "Something went wrong.");
            return;
        }
        if (action === "waiting-update") {
            renderWaiting(data);
            return;
        }
        if (action === "settings") {
            renderWaiting(data.room || data);
            return;
        }
        if (action === "host-changed") {
            var becameHost = !isHost && (!!data.is_host || sameName(data.host, username));
            isHost = !!data.is_host || sameName(data.host, username);
            applyHostUi();
            renderWaiting(data.room);
            if (becameHost) {
                showToast("You are now the host.");
                announceWaiters(Object.keys(knownWaiters).map(function (key) {
                    return knownWaiters[key];
                }).filter(function (name) {
                    return !sameName(name, username);
                }));
            }
            return;
        }
        if (action === "peer-left") {
            if (sameName(data.peer, username)) {
                return;
            }
            if (data.reason === "replaced") {
                markPeerReplaced(data.peer);
            } else if (inCall && !sessionDead) {
                announcePresence(data.peer, "leave");
            }
            cleanupPeer(data.peer);
            if (admittedInCall > 1) {
                admittedInCall -= 1;
            }
            updateGridLayout();
            syncSoloIdle();
            return;
        }
        if (action === "room-closed") {
            endSession({
                panel: "blocked",
                title: "This meeting has ended",
                copy: data.message || "The room has closed.",
                hideReuse: true,
            });
        }
    }

    function webSocketOnMessage(event) {
        var parseData;
        try {
            parseData = JSON.parse(event.data);
        } catch (err) {
            return;
        }
        var action = parseData.action;
        if (ROOM_ACTIONS[action]) {
            handleRoomEvent(parseData);
            return;
        }
        if (sessionDead || !inCall) {
            return;
        }

        var peerUsername = parseData.peer;
        if (sameName(username, peerUsername)) {
            return;
        }
        var receiver_channel_name = parseData.message && parseData.message.receiver_channel_name;
        if (action === "new-peer") {
            var alreadyPeer = !!mapPeers[resolvePeerKey(peerUsername)];
            var fromReplace = consumePeerReplaced(peerUsername);
            createOfferer(peerUsername, receiver_channel_name);
            if (!alreadyPeer && !fromReplace) {
                announcePresence(peerUsername, "join");
            }
            admittedInCall = Math.max(admittedInCall, 2);
            syncSoloIdle();
            return;
        }
        if (action === "new-offer") {
            createAnswerer(parseData.message.sdp, peerUsername, receiver_channel_name);
            return;
        }
        if (action === "new-answer") {
            var answerPeer = mapPeers[resolvePeerKey(peerUsername)];
            var livePeer = answerPeer && answerPeer[0];
            if (livePeer && parseData.message && parseData.message.sdp) {
                livePeer.setRemoteDescription(parseData.message.sdp).catch(function () {});
            }
        }
    }

    function connectSocket() {
        sessionDead = false;
        closeSocket();
        webSocket = new WebSocket(wsUrl());
        webSocket.addEventListener("open", function () {
            sendJoin();
        });
        webSocket.addEventListener("message", webSocketOnMessage);
        webSocket.addEventListener("close", function (event) {
            if (sessionDead) {
                return;
            }
            if (event.code === 4402) {
                endSession({
                    panel: "blocked",
                    title: "You’re in this meeting in another tab",
                    copy: "Video and mic on this tab were stopped. Continue here or go home.",
                });
                return;
            }
            if (event.code === 4403) {
                endSession({
                    panel: "blocked",
                    title: "You weren’t admitted",
                    copy: "The host declined your join request.",
                    hideReuse: true,
                });
                return;
            }
            if (event.code === 4404) {
                endSession({
                    panel: "blocked",
                    title: "This meeting has ended",
                    copy: "The room expired.",
                    hideReuse: true,
                });
            }
        });
        webSocket.addEventListener("error", function () {
            if (!sessionDead) {
                showToast("Connection error.");
            }
        });
    }

    function startJoin(options) {
        options = options || {};
        unlockNotifySound();
        var typed = usernameInput && usernameInput.value ? usernameInput.value.trim() : "";
        username = (options.username || typed || username || "").trim();
        if (!username) {
            setJoinError("Enter a name.");
            return;
        }
        joinReplace = !!options.replace;
        setJoinError("");
        if (usernameInput && !options.fromModal) {
            usernameInput.value = username;
        }
        if (usernameInput) {
            usernameInput.disabled = true;
        }
        if (btnJoin) {
            btnJoin.disabled = true;
        }
        if (canJoinOverSocket()) {
            sendJoin();
            return;
        }
        connectSocket();
    }

    if (btnJoin) {
        btnJoin.addEventListener("click", startJoin);
    }
    if (usernameInput) {
        usernameInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                startJoin();
            }
        });
    }

    if (btnReuseTab) {
        btnReuseTab.addEventListener("click", function () {
            sessionDead = false;
            hideNameTakenModal();
            if (usernameInput) {
                usernameInput.value = username;
                usernameInput.disabled = false;
            }
            if (btnJoin) {
                btnJoin.disabled = false;
            }
            startJoin({ replace: true, username: username });
        });
    }

    function submitChangedName() {
        var next = nameTakenInput && nameTakenInput.value ? nameTakenInput.value.trim() : "";
        if (!next) {
            setNameTakenError("Enter a different name.");
            return;
        }
        if (sameName(next, takenName || username)) {
            setNameTakenError("Pick a different name, or tap That’s me if this is your other tab.");
            return;
        }
        setNameTakenError("");
        if (usernameInput) {
            usernameInput.value = next;
        }
        startJoin({ username: next, replace: false, fromModal: true });
    }

    function submitTakeover() {
        var me = (takenName || username || "").trim();
        if (!me) {
            setNameTakenError("Enter your name first.");
            return;
        }
        setNameTakenError("");
        if (usernameInput) {
            usernameInput.value = me;
        }
        startJoin({ username: me, replace: true, fromModal: true });
    }

    if (btnSoloStay) {
        btnSoloStay.addEventListener("click", function () {
            if (sessionDead || !inCall) {
                return;
            }
            hideSoloIdleModal();
            soloDeadline = Date.now() + SOLO_IDLE_MS;
            soloWarned = false;
            syncSoloIdle();
        });
    }
    if (btnSoloLeave) {
        btnSoloLeave.addEventListener("click", function () {
            endSoloIdleCall();
        });
    }

    if (btnNameChange) {
        btnNameChange.addEventListener("click", submitChangedName);
    }
    if (btnNameTakeover) {
        btnNameTakeover.addEventListener("click", submitTakeover);
    }
    if (nameTakenInput) {
        nameTakenInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                event.preventDefault();
                submitChangedName();
            }
        });
    }
    if (nameTakenModal) {
        nameTakenModal.addEventListener("click", function (event) {
            if (event.target === nameTakenModal) {
                hideNameTakenModal();
            }
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape" && nameTakenModal && !nameTakenModal.hidden) {
                hideNameTakenModal();
            }
        });
    }

    if (btnCopyLink) {
        btnCopyLink.addEventListener("click", function () {
            var link = window.location.href;
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(link).then(function () {
                    showToast("Link copied.");
                }).catch(function () {
                    window.prompt("Copy this link", link);
                });
            } else {
                window.prompt("Copy this link", link);
            }
        });
    }

    if (btnChat) {
        btnChat.addEventListener("click", function () { toggleDrawer("chat"); });
    }
    if (toastEl) {
        toastEl.addEventListener("click", function () {
            if (!inCall || sessionDead) {
                return;
            }
            if (toastEl.dataset.chat === "1") {
                toggleDrawer("chat");
                return;
            }
            if (toastEl.dataset.people === "1") {
                toggleDrawer("people");
            }
        });
    }
    if (btnPeople) {
        btnPeople.addEventListener("click", function () { toggleDrawer("people"); });
    }
    if (btnSettings) {
        btnSettings.addEventListener("click", function () { toggleDrawer("settings"); });
    }
    document.querySelectorAll("[data-close-drawer]").forEach(function (btn) {
        btn.addEventListener("click", closeDrawers);
    });
    if (openForAllInput) {
        openForAllInput.addEventListener("change", function () {
            sendRaw({ action: "set-open-for-all", open_for_all: openForAllInput.checked });
        });
    }
    if (btnLeave) {
        btnLeave.addEventListener("click", function (event) {
            event.preventDefault();
            endSession({ panel: "blocked", hideReuse: true, title: "You left the meeting", copy: "You can go home or start another room." });
            window.location.href = btnLeave.getAttribute("href") || "/";
        });
    }

    window.addEventListener("pagehide", function () {
        teardownPeers();
        stopLocalMedia();
        closeSocket();
    });

    var constraints = { video: true, audio: true };

    function syncMediaButtons() {
        if (btnToggleAudio) {
            btnToggleAudio.classList.toggle("off", !audioOn);
            btnToggleAudio.title = audioOn ? "Mute microphone" : "Turn on microphone";
            btnToggleAudio.setAttribute("aria-label", btnToggleAudio.title);
        }
        if (btnToggleVideo) {
            btnToggleVideo.classList.toggle("off", !videoOn);
            btnToggleVideo.title = videoOn ? "Turn off camera" : "Turn on camera";
            btnToggleVideo.setAttribute("aria-label", btnToggleVideo.title);
        }
    }

    function isChatOpen() {
        return !!(chatDrawer && !chatDrawer.hidden);
    }

    function scrollChatToEnd() {
        var scroller = document.getElementById("messages");
        if (scroller) {
            scroller.scrollTop = scroller.scrollHeight;
        }
    }

    function formatUnread(count) {
        if (count > 99) {
            return "99+";
        }
        return String(count);
    }

    function renderChatBadge() {
        if (!chatBadge) {
            return;
        }
        var n = unreadChat;
        chatBadge.textContent = formatUnread(n);
        chatBadge.hidden = n <= 0;
        if (btnChat) {
            btnChat.setAttribute(
                "aria-label",
                n > 0 ? "Toggle chat, " + n + " unread" : "Toggle chat"
            );
        }
    }

    function resetChatUnread() {
        unreadChat = 0;
        renderChatBadge();
    }

    function parseChatLine(raw) {
        var text = String(raw == null ? "" : raw);
        var idx = text.indexOf(": ");
        if (idx <= 0) {
            return { sender: "", body: text };
        }
        return { sender: text.slice(0, idx), body: text.slice(idx + 2) };
    }

    function clipToast(text, max) {
        var value = String(text || "").replace(/\s+/g, " ").trim();
        max = max || 72;
        if (value.length <= max) {
            return value;
        }
        return value.slice(0, max - 1) + "…";
    }

    function ensureLocalMedia() {
        if (mediaReady) {
            return mediaReady;
        }
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            mediaReady = Promise.reject(new Error("Media devices are not available."));
            return mediaReady;
        }
        mediaReady = navigator.mediaDevices.getUserMedia(constraints)
            .then(function (stream) {
                if (sessionDead) {
                    stream.getTracks().forEach(function (track) { track.stop(); });
                    throw new Error("Session ended before media started.");
                }
                localStream = stream;
                if (localVideo) {
                    localVideo.srcObject = localStream;
                    localVideo.muted = true;
                }
                var audioTracks = stream.getAudioTracks();
                var videoTracks = stream.getVideoTracks();
                if (audioTracks[0]) {
                    audioTracks[0].enabled = audioOn;
                }
                if (videoTracks[0]) {
                    videoTracks[0].enabled = videoOn;
                } else {
                    videoOn = false;
                }
                setTileVideoOff(localTile, !localCameraOn());
                broadcastMediaState();
                if (!mediaControlsBound) {
                    mediaControlsBound = true;
                    if (btnToggleAudio) {
                        btnToggleAudio.addEventListener("click", function () {
                            audioOn = !audioOn;
                            var liveAudio = localStream.getAudioTracks()[0];
                            if (liveAudio) {
                                liveAudio.enabled = audioOn;
                            }
                            syncMediaButtons();
                        });
                    }
                    if (btnToggleVideo) {
                        btnToggleVideo.addEventListener("click", function () {
                            videoOn = !videoOn;
                            var liveVideo = localStream.getVideoTracks()[0];
                            if (liveVideo) {
                                liveVideo.enabled = videoOn;
                            }
                            setTileVideoOff(localTile, !localCameraOn());
                            syncMediaButtons();
                            broadcastMediaState();
                        });
                    }
                }
                syncMediaButtons();
                return stream;
            });
        return mediaReady;
    }

    if (btnSendMsg) {
        btnSendMsg.addEventListener("click", sendMsgOnClick);
    }
    if (messageInput) {
        messageInput.addEventListener("keydown", function (event) {
            if (event.key === "Enter") {
                sendMsgOnClick();
            }
        });
    }

    function sendMsgOnClick() {
        if (!messageInput || sessionDead) {
            return;
        }
        var message = messageInput.value.trim();
        if (!message) {
            return;
        }
        var li = document.createElement("li");
        li.appendChild(document.createTextNode("Me: " + message));
        messageList.appendChild(li);
        scrollChatToEnd();
        var outbound = username + ": " + message;
        getDataChannels().forEach(function (channel) {
            if (channel && channel.readyState === "open") {
                channel.send(outbound);
            }
        });
        messageInput.value = "";
    }

    function firstLetter(name) {
        var text = String(name || "").trim();
        if (!text) {
            return "?";
        }
        var match = text.match(/[A-Za-z0-9\u00C0-\u024F]/);
        var ch = match ? match[0] : Array.from(text)[0];
        return String(ch || "?").toUpperCase();
    }

    function setTileLetter(tile, name) {
        if (!tile) {
            return;
        }
        var letter = tile.querySelector(".tile-letter");
        if (letter) {
            letter.textContent = firstLetter(name);
        }
    }

    function setTileVideoOff(tile, off) {
        if (!tile) {
            return;
        }
        tile.classList.toggle("video-off", !!off);
    }

    function allTiles() {
        if (!videoGrid) {
            return [];
        }
        return Array.prototype.slice.call(videoGrid.querySelectorAll(".tile"));
    }

    function letterPx(size) {
        var box = Math.max(28, Math.min(128, Math.round(size * 0.38)));
        return { box: box, font: Math.max(12, Math.round(box * 0.4)) };
    }

    function applyLetterVars(size, prefix) {
        prefix = prefix || "tile";
        var metrics = letterPx(size);
        if (prefix === "tile") {
            videoGrid.style.setProperty("--tile-letter", metrics.box + "px");
            videoGrid.style.setProperty("--tile-letter-font", metrics.font + "px");
            return;
        }
        if (prefix === "pin") {
            videoGrid.style.setProperty("--pin-letter", metrics.box + "px");
            videoGrid.style.setProperty("--pin-letter-font", metrics.font + "px");
            return;
        }
        videoGrid.style.setProperty("--strip-letter", metrics.box + "px");
        videoGrid.style.setProperty("--strip-letter-font", metrics.font + "px");
    }

    function bestSquareLayout(count, width, height, gap) {
        var n = Math.max(1, count);
        var w = Math.max(80, width);
        var h = Math.max(80, height);
        var best = { cols: 1, size: 0 };
        var maxCols = Math.min(5, n);
        var cols;
        for (cols = 1; cols <= maxCols; cols += 1) {
            var rows = Math.ceil(n / cols);
            var size = Math.floor(Math.min(
                (w - gap * (cols - 1)) / cols,
                (h - gap * (rows - 1)) / rows
            ));
            if (size > best.size) {
                best = { cols: cols, size: size };
            }
        }
        return best;
    }

    function updateGridLayout() {
        if (!videoGrid) {
            return;
        }
        var tiles = allTiles();
        var n = tiles.length;
        videoGrid.classList.remove("tiles-1", "tiles-2", "tiles-3", "tiles-4", "tiles-many", "is-pinned", "is-overflow");
        tiles.forEach(function (tile) {
            tile.classList.remove("is-pinned");
            tile.style.gridColumn = "";
            tile.style.gridRow = "";
        });
        if (pinnedPeer && !tiles.some(function (tile) { return tile.dataset.peer === pinnedPeer; })) {
            pinnedPeer = "";
        }
        var width = videoGrid.clientWidth || 0;
        var height = videoGrid.clientHeight || 0;
        var gap = 12;

        if (pinnedPeer && n > 1) {
            videoGrid.classList.add("is-pinned");
            var others = n - 1;
            var narrow = width > 0 && width < 800;
            var pinSize;
            var stripSize;
            if (narrow) {
                pinSize = Math.max(140, Math.min(width, Math.floor(height * 0.42)));
                stripSize = Math.max(72, Math.min(112, Math.floor((width - gap * Math.max(0, Math.min(others, 3) - 1)) / Math.min(others, 4))));
            } else {
                stripSize = Math.max(88, Math.min(148, Math.floor((height - gap * Math.max(0, others - 1)) / Math.max(1, others))));
                pinSize = Math.max(160, Math.min(height, width - stripSize - gap));
            }
            videoGrid.style.setProperty("--tile-size", pinSize + "px");
            videoGrid.style.setProperty("--strip-size", stripSize + "px");
            applyLetterVars(pinSize, "pin");
            applyLetterVars(stripSize, "strip");
            var row = 0;
            tiles.forEach(function (tile) {
                if (tile.dataset.peer === pinnedPeer) {
                    tile.classList.add("is-pinned");
                    tile.style.gridColumn = "1";
                    tile.style.gridRow = "1 / span " + others;
                } else {
                    row += 1;
                    tile.style.gridColumn = "2";
                    tile.style.gridRow = String(row);
                }
            });
            return;
        }

        var layout = bestSquareLayout(Math.max(n, 1), width, height, gap);
        var size = layout.size;
        if (n <= 1) {
            size = Math.min(size, 520);
        }
        var overflow = size < 72;
        if (overflow) {
            size = 72;
            videoGrid.classList.add("is-overflow");
        }
        videoGrid.style.setProperty("--tile-size", size + "px");
        applyLetterVars(size, "tile");
    }

    function togglePin(peerId) {
        if (!peerId || allTiles().length < 2) {
            return;
        }
        pinnedPeer = pinnedPeer === peerId ? "" : peerId;
        updateGridLayout();
    }

    function bindPinButton(button) {
        if (!button || button.dataset.bound === "1") {
            return;
        }
        button.dataset.bound = "1";
        button.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            togglePin(button.getAttribute("data-pin"));
        });
    }

    function watchVideoTrack(tile, track, videoEl, peerUsername) {
        if (!tile) {
            return;
        }
        if (typeof tile._unwatchVideo === "function") {
            tile._unwatchVideo();
            tile._unwatchVideo = null;
        }
        if (!track) {
            setTileVideoOff(tile, true);
            return;
        }
        function sync() {
            if (remoteVideoDesired[peerUsername] === false) {
                setTileVideoOff(tile, true);
                return;
            }
            var ended = track.readyState === "ended";
            var muted = !!track.muted;
            var noFrames = !videoEl || videoEl.videoWidth < 2 || videoEl.videoHeight < 2;
            setTileVideoOff(tile, ended || muted || noFrames);
        }
        track.addEventListener("mute", sync);
        track.addEventListener("unmute", sync);
        track.addEventListener("ended", sync);
        if (videoEl) {
            videoEl.addEventListener("loadeddata", sync);
            videoEl.addEventListener("resize", sync);
        }
        tile._unwatchVideo = function () {
            track.removeEventListener("mute", sync);
            track.removeEventListener("unmute", sync);
            track.removeEventListener("ended", sync);
            if (videoEl) {
                videoEl.removeEventListener("loadeddata", sync);
                videoEl.removeEventListener("resize", sync);
            }
        };
        sync();
    }

    function safeVideoId(name) {
        return "remote-" + encodeURIComponent(name);
    }

    function cleanupPeer(peerUsername) {
        var key = resolvePeerKey(peerUsername);
        var entry = mapPeers[key];
        if (entry) {
            delete mapPeers[key];
            if (entry[0]) {
                window.clearTimeout(entry[0]._iceDropTimer);
                try {
                    entry[0].close();
                } catch (err) {}
            }
        }
        var remoteVideo = document.getElementById(safeVideoId(key));
        if (!remoteVideo && key !== peerUsername) {
            remoteVideo = document.getElementById(safeVideoId(peerUsername));
        }
        if (remoteVideo) {
            if (remoteVideo.srcObject) {
                remoteVideo.srcObject.getTracks().forEach(function (track) {
                    try { track.stop(); } catch (err) {}
                });
                remoteVideo.srcObject = null;
            }
            removevideo(remoteVideo);
        }
        delete remoteVideoDesired[key];
        delete remoteVideoDesired[peerUsername];
        if (sameName(pinnedPeer, key) || sameName(pinnedPeer, peerUsername)) {
            pinnedPeer = "";
        }
        updateGridLayout();
    }

    function createOfferer(peerUsername, receiver_channel_name) {
        if (!peerUsername || !receiver_channel_name || sessionDead || sameName(peerUsername, username)) {
            return;
        }
        if (mapPeers[resolvePeerKey(peerUsername)]) {
            cleanupPeer(peerUsername);
        }
        var peer = new RTCPeerConnection(null);
        addLocalTracks(peer);
        var dc = peer.createDataChannel("channel");
        bindDataChannel(dc, peerUsername);
        var remoteVideo = createVideo(peerUsername);
        setOnTrack(peer, remoteVideo);
        mapPeers[peerUsername] = [peer, dc];
        watchIce(peer, peerUsername, remoteVideo);
        peer.addEventListener("icecandidate", function (event) {
            if (event.candidate || !isCurrentPeer(peer, peerUsername) || sessionDead) {
                return;
            }
            sendSignal("new-offer", {
                sdp: peer.localDescription,
                receiver_channel_name: receiver_channel_name,
            });
        });
        peer.createOffer()
            .then(function (offer) {
                if (sessionDead || !isCurrentPeer(peer, peerUsername)) {
                    return;
                }
                return peer.setLocalDescription(offer);
            })
            .catch(function (error) { console.log("Error creating offer:", error); });
    }

    function createAnswerer(offer, peerUsername, receiver_channel_name) {
        if (!peerUsername || !offer || !receiver_channel_name || sessionDead || sameName(peerUsername, username)) {
            return;
        }
        if (mapPeers[resolvePeerKey(peerUsername)]) {
            cleanupPeer(peerUsername);
        }
        var peer = new RTCPeerConnection(null);
        addLocalTracks(peer);
        var remoteVideo = createVideo(peerUsername);
        setOnTrack(peer, remoteVideo);
        mapPeers[peerUsername] = [peer, null];
        peer.addEventListener("datachannel", function (event) {
            if (!isCurrentPeer(peer, peerUsername)) {
                return;
            }
            peer.dc = event.channel;
            bindDataChannel(peer.dc, peerUsername);
            mapPeers[peerUsername] = [peer, peer.dc];
        });
        watchIce(peer, peerUsername, remoteVideo);
        peer.addEventListener("icecandidate", function (event) {
            if (event.candidate || !isCurrentPeer(peer, peerUsername) || sessionDead) {
                return;
            }
            sendSignal("new-answer", {
                sdp: peer.localDescription,
                receiver_channel_name: receiver_channel_name,
            });
        });
        peer.setRemoteDescription(offer)
            .then(function () {
                if (sessionDead || !isCurrentPeer(peer, peerUsername)) {
                    return;
                }
                return peer.createAnswer();
            })
            .then(function (answer) {
                if (!answer || sessionDead || !isCurrentPeer(peer, peerUsername)) {
                    return;
                }
                return peer.setLocalDescription(answer);
            })
            .catch(function (error) { console.log("Error in answerer:", error); });
    }

    function watchIce(peer, peerUsername, remoteVideo) {
        peer.addEventListener("iceconnectionstatechange", function () {
            var iceConnectionState = peer.iceConnectionState;
            if (iceConnectionState !== "failed" && iceConnectionState !== "disconnected" && iceConnectionState !== "closed") {
                window.clearTimeout(peer._iceDropTimer);
                return;
            }
            if (!isCurrentPeer(peer, peerUsername)) {
                return;
            }
            if (iceConnectionState === "disconnected") {
                window.clearTimeout(peer._iceDropTimer);
                peer._iceDropTimer = window.setTimeout(function () {
                    if (!isCurrentPeer(peer, peerUsername)) {
                        return;
                    }
                    if (peer.iceConnectionState !== "disconnected" && peer.iceConnectionState !== "failed") {
                        return;
                    }
                    cleanupPeer(peerUsername);
                }, 4000);
                return;
            }
            cleanupPeer(peerUsername);
        });
    }

    function addLocalTracks(peer) {
        localStream.getTracks().forEach(function (track) {
            peer.addTrack(track, localStream);
        });
    }

    function dcOnMessage(event) {
        if (!messageList || sessionDead || !inCall) {
            return;
        }
        var raw = event && event.data != null ? String(event.data) : "";
        if (!raw) {
            return;
        }
        var parsed = parseChatLine(raw);
        if (parsed.sender && sameName(parsed.sender, username)) {
            return;
        }
        var li = document.createElement("li");
        li.appendChild(document.createTextNode(raw));
        messageList.appendChild(li);
        scrollChatToEnd();
        if (isChatOpen()) {
            return;
        }
        unreadChat += 1;
        renderChatBadge();
        var who = parsed.sender || "Someone";
        var body = parsed.body || raw;
        showToast(clipToast(who + ": " + body), { chat: true, sound: "chat" });
    }

    function createVideo(peerUsername) {
        var existing = document.getElementById(safeVideoId(peerUsername));
        if (existing) {
            return existing;
        }
        var tile = document.createElement("article");
        tile.className = "tile video-off";
        tile.dataset.peer = peerUsername;
        var remoteVideo = document.createElement("video");
        remoteVideo.id = safeVideoId(peerUsername);
        remoteVideo.autoplay = true;
        remoteVideo.playsInline = true;
        var avatar = document.createElement("div");
        avatar.className = "tile-avatar";
        avatar.setAttribute("aria-hidden", "true");
        var letter = document.createElement("span");
        letter.className = "tile-letter";
        letter.textContent = firstLetter(peerUsername);
        avatar.appendChild(letter);
        var pin = document.createElement("button");
        pin.type = "button";
        pin.className = "tile-pin";
        pin.setAttribute("data-pin", peerUsername);
        pin.title = "Pin";
        pin.setAttribute("aria-label", "Pin " + peerUsername);
        pin.innerHTML = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M16 9V4h1V2H7v2h1v5c0 1.66-1.34 3-3 3v2h5.97v7l1 1 1-1v-7H19v-2c-1.66 0-3-1.34-3-3z"/></svg>';
        var label = document.createElement("span");
        label.className = "tile-name";
        label.textContent = peerUsername;
        tile.appendChild(remoteVideo);
        tile.appendChild(avatar);
        tile.appendChild(pin);
        tile.appendChild(label);
        videoGrid.appendChild(tile);
        bindPinButton(pin);
        updateGridLayout();
        if (Object.prototype.hasOwnProperty.call(remoteVideoDesired, peerUsername)) {
            applyRemoteMedia(peerUsername, { video: remoteVideoDesired[peerUsername] });
        }
        return remoteVideo;
    }

    function setOnTrack(peer, remoteVideo) {
        var remoteStream = new MediaStream();
        remoteVideo.srcObject = remoteStream;
        var tile = remoteVideo.closest ? remoteVideo.closest(".tile") : remoteVideo.parentNode;
        peer.addEventListener("track", function (event) {
            remoteStream.addTrack(event.track);
            if (event.track && event.track.kind === "video") {
                watchVideoTrack(tile, event.track, remoteVideo, tile && tile.dataset ? tile.dataset.peer : "");
            }
        });
    }

    function removevideo(video) {
        if (!video) {
            return;
        }
        var tile = video.closest ? video.closest(".tile") : video.parentNode;
        if (tile && typeof tile._unwatchVideo === "function") {
            tile._unwatchVideo();
            tile._unwatchVideo = null;
        }
        if (tile && tile.parentNode && !tile.classList.contains("tile-local")) {
            tile.parentNode.removeChild(tile);
            updateGridLayout();
        }
    }

    if (localTile) {
        bindPinButton(localTile.querySelector(".tile-pin"));
        setTileLetter(localTile, "You");
        setTileVideoOff(localTile, true);
        updateGridLayout();
    }
    syncMediaButtons();
    renderChatBadge();
    document.addEventListener("pointerdown", unlockNotifySound, true);
    document.addEventListener("keydown", unlockNotifySound, true);
    if (videoGrid && typeof ResizeObserver === "function") {
        var gridObserver = new ResizeObserver(function () {
            updateGridLayout();
        });
        gridObserver.observe(videoGrid);
    } else {
        window.addEventListener("resize", updateGridLayout);
    }

    function getDataChannels() {
        var channels = [];
        Object.keys(mapPeers).forEach(function (peerUsername) {
            var entry = mapPeers[peerUsername];
            if (entry && entry[1]) {
                channels.push(entry[1]);
            }
        });
        return channels;
    }
})();
