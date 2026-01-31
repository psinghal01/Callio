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
    var iceQueues = {};
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
    var remoteAudioDesired = {};
    var remoteSoundReady = false;
    var boundDataChannels = typeof WeakSet === "function" ? new WeakSet() : null;
    var MEDIA_PREFIX = "__CALLIO__/v1 ";
    var CHAT_MAX_LEN = 2000;
    var CHAT_MAX_ITEMS = 200;
    var CHAT_EMOJIS = [
        "😀", "😃", "😄", "😁", "😅", "😂", "😊", "🙂", "😉", "😍",
        "😘", "😜", "🤔", "😐", "😴", "😢", "😭", "😡", "👍", "👎",
        "👏", "🙏", "❤️", "🔥", "✨", "🎉", "😎", "🤗", "🙌", "💯",
        "🤝", "💪", "👋", "👌", "🌟", "✅", "❌", "📌", "😮", "🤣"
    ];
    var MIC_ICON_HTML =
        '<svg class="mic-on" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm5-3c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>' +
        '<svg class="mic-slash" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M19 11h-1.7c0 .74-.16 1.43-.43 2.05l1.23 1.23c.56-.98.9-2.09.9-3.28zm-4.02.17c0-.06.02-.11.02-.17V5c0-1.66-1.34-3-3-3S9 3.34 9 5v.18l5.98 5.99zM4.27 3 3 4.27l6.01 6.01V11c0 1.66 1.33 3 2.99 3 .22 0 .44-.03.65-.08l1.66 1.66c-.71.33-1.5.52-2.31.52-2.76 0-5.3-2.1-5.3-5.1H5c0 3.41 2.72 6.23 6 6.72V21h2v-3.28c.91-.13 1.77-.45 2.54-.9L19.73 21 21 19.73 4.27 3z"/></svg>';

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
    var btnEmoji = document.querySelector("#btn-emoji");
    var emojiPanel = document.querySelector("#emoji-panel");
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

    function localMicOn() {
        if (!audioOn || !localStream) {
            return false;
        }
        return localStream.getAudioTracks().some(function (track) {
            return track.readyState === "live";
        });
    }

    function mediaPayload() {
        return MEDIA_PREFIX + JSON.stringify({
            t: "media",
            video: localCameraOn(),
            audio: localMicOn(),
        });
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

    function parseCallioEnvelope(raw) {
        if (typeof raw !== "string" || raw.indexOf(MEDIA_PREFIX) !== 0) {
            return null;
        }
        try {
            var data = JSON.parse(raw.slice(MEDIA_PREFIX.length));
            if (!data || (data.t !== "media" && data.t !== "chat")) {
                return null;
            }
            return data;
        } catch (err) {
            return null;
        }
    }

    function parseMediaSignal(raw) {
        var data = parseCallioEnvelope(raw);
        if (!data || data.t !== "media") {
            return null;
        }
        return data;
    }

    function tileForPeer(peerUsername) {
        var video = document.getElementById(safeVideoId(peerUsername));
        if (!video) {
            return null;
        }
        return video.closest ? video.closest(".tile") : video.parentNode;
    }

    function applyRemoteMedia(peerUsername, data) {
        if (!peerUsername || !data) {
            return;
        }
        if (Object.prototype.hasOwnProperty.call(data, "video")) {
            remoteVideoDesired[peerUsername] = !!data.video;
        }
        if (Object.prototype.hasOwnProperty.call(data, "audio")) {
            remoteAudioDesired[peerUsername] = !!data.audio;
        }
        var tile = tileForPeer(peerUsername);
        if (!tile) {
            return;
        }
        ensureTileChrome(tile, peerUsername);
        setTileMicOff(tile, remoteAudioDesired[peerUsername] !== true);
        if (Object.prototype.hasOwnProperty.call(remoteVideoDesired, peerUsername)) {
            if (!remoteVideoDesired[peerUsername]) {
                setTileVideoOff(tile, true);
            } else {
                var video = document.getElementById(safeVideoId(peerUsername));
                var hasFrames = video && video.videoWidth > 1 && video.videoHeight > 1;
                setTileVideoOff(tile, !hasFrames);
            }
        }
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
            var envelope = parseCallioEnvelope(event.data);
            if (envelope && envelope.t === "media") {
                applyRemoteMedia(peerUsername, envelope);
                return;
            }
            if (envelope && envelope.t === "chat") {
                receiveChat(envelope, peerUsername);
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
        hideEmojiPanel();
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
        setTileMicOff(localTile, true);
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
        iceQueues = {};
        clearSoloIdle(true);
        resetChatUnread();
        clearChatMessages();
        hideEmojiPanel();
        teardownPeers();
        stopLocalMedia();
        remoteSoundReady = false;
        remoteAudioDesired = {};
        closeSocket();
        closeDrawers();
        updateGridLayout();
        setTileVideoOff(localTile, true);
        setTileMicOff(localTile, true);
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
        useCallAudioSession();
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
                setTileMicOff(localTile, true);
                syncMediaButtons();
                broadcastMediaState();
                showToast(mediaErrorMessage());
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
            if (!alreadyPeer) {
                createOfferer(peerUsername, receiver_channel_name);
            }
            if (!alreadyPeer && !fromReplace) {
                announcePresence(peerUsername, "join");
            }
            admittedInCall = Math.max(admittedInCall, 2);
            syncSoloIdle();
            return;
        }
        if (action === "new-offer") {
            var offerPeer = mapPeers[resolvePeerKey(peerUsername)];
            var offerPc = offerPeer && offerPeer[0];
            if (offerPc && offerPc.signalingState === "have-local-offer") {
                return;
            }
            createAnswerer(parseData.message.sdp, peerUsername, receiver_channel_name);
            return;
        }
        if (action === "new-answer") {
            var answerPeer = mapPeers[resolvePeerKey(peerUsername)];
            var livePeer = answerPeer && answerPeer[0];
            if (livePeer && receiver_channel_name) {
                livePeer._signalTo = receiver_channel_name;
            }
            if (livePeer && parseData.message && parseData.message.sdp) {
                livePeer.setRemoteDescription(parseData.message.sdp)
                    .then(function () {
                        if (!isCurrentPeer(livePeer, peerUsername) || sessionDead) {
                            return;
                        }
                        flushIceQueue(peerUsername);
                    })
                    .catch(function () {});
            }
            return;
        }
        if (action === "ice-candidate") {
            queueOrAddIce(peerUsername, parseData.message && parseData.message.candidate);
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

    function useCallAudioSession() {
        try {
            if (navigator.audioSession) {
                navigator.audioSession.type = "play-and-record";
            }
        } catch (err) {}
    }

    function mediaSupported() {
        return !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    }

    function mediaErrorMessage() {
        if (window.isSecureContext === false) {
            return "Phone browsers block camera and mic on http://. In Chrome, add this site under chrome://flags → Insecure origins treated as secure, or use HTTPS.";
        }
        if (!mediaSupported()) {
            return "This browser cannot use the camera or microphone.";
        }
        return "Camera or microphone is blocked. Allow access in the browser site settings.";
    }

    function liveLocalTracks() {
        if (!localStream) {
            return [];
        }
        return localStream.getTracks().filter(function (track) {
            return track.readyState === "live";
        });
    }

    function hasLiveMedia() {
        return liveLocalTracks().length > 0;
    }

    function remoteVideoEl(tile) {
        if (!tile) {
            return null;
        }
        var video = tile.querySelector("video");
        if (!video || video.id === "local-video") {
            return null;
        }
        return video;
    }

    function applyRemotePlayback(video) {
        if (!video || video.id === "local-video") {
            return;
        }
        var unlocked = remoteSoundReady;
        var tile = video.closest ? video.closest(".tile") : video.parentNode;
        video.muted = !unlocked;
        video.defaultMuted = !unlocked;
        video.setAttribute("playsinline", "");
        video.setAttribute("webkit-playsinline", "");
        try {
            video.volume = 1;
        } catch (err) {}
        if (video.paused) {
            var play = video.play();
            if (play && typeof play.then === "function") {
                play.then(function () {
                    if (unlocked) {
                        hideHearHint(tile);
                    }
                }).catch(function () {
                    if (unlocked) {
                        showHearHint(tile);
                    }
                });
            }
            return;
        }
        if (unlocked) {
            hideHearHint(tile);
        }
    }

    function attachRemoteStream(video, stream) {
        if (!video || !stream) {
            return;
        }
        if (video.srcObject !== stream) {
            video.srcObject = stream;
        }
        applyRemotePlayback(video);
    }

    function hideHearHint(tile) {
        if (!tile) {
            return;
        }
        var btn = tile.querySelector(".hear-btn");
        if (btn && btn.parentNode) {
            btn.parentNode.removeChild(btn);
        }
    }

    function hideHearHints() {
        if (!videoGrid) {
            return;
        }
        var hints = videoGrid.querySelectorAll(".hear-btn");
        for (var i = 0; i < hints.length; i++) {
            if (hints[i].parentNode) {
                hints[i].parentNode.removeChild(hints[i]);
            }
        }
    }

    function showHearHint(tile) {
        if (!tile || tile.classList.contains("tile-local") || tile.querySelector(".hear-btn")) {
            return;
        }
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "hear-btn";
        btn.textContent = "Tap to hear";
        btn.addEventListener("click", function (event) {
            event.preventDefault();
            event.stopPropagation();
            unlockRemoteAudio();
        });
        tile.appendChild(btn);
    }

    function addInboundTrack(stream, track) {
        if (!stream || !track) {
            return;
        }
        if (stream.getTracks().some(function (existing) {
            return existing.id === track.id;
        })) {
            return;
        }
        try {
            stream.addTrack(track);
        } catch (err) {}
    }

    function pruneEndedTracks(stream) {
        if (!stream) {
            return;
        }
        stream.getTracks().forEach(function (track) {
            if (track.readyState === "ended") {
                try {
                    stream.removeTrack(track);
                } catch (err) {}
            }
        });
    }

    function mergeInbound(tile, peer, event) {
        if (!tile) {
            return new MediaStream();
        }
        if (!tile._inbound) {
            tile._inbound = new MediaStream();
        }
        var inbound = tile._inbound;
        pruneEndedTracks(inbound);
        if (event) {
            addInboundTrack(inbound, event.track);
            if (event.streams) {
                for (var i = 0; i < event.streams.length; i++) {
                    var stream = event.streams[i];
                    if (!stream || !stream.getTracks) {
                        continue;
                    }
                    stream.getTracks().forEach(function (track) {
                        addInboundTrack(inbound, track);
                    });
                }
            }
        }
        if (peer && typeof peer.getReceivers === "function") {
            peer.getReceivers().forEach(function (receiver) {
                if (receiver && receiver.track) {
                    addInboundTrack(inbound, receiver.track);
                }
            });
        }
        return inbound;
    }

    function disposeTileAudio(tile) {
        if (!tile) {
            return;
        }
        if (tile._audioWatched) {
            Object.keys(tile._audioWatched).forEach(function (id) {
                if (typeof tile._audioWatched[id] === "function") {
                    tile._audioWatched[id]();
                }
            });
            tile._audioWatched = null;
        }
        if (tile._out) {
            try {
                tile._out.pause();
            } catch (err) {}
            tile._out.srcObject = null;
            if (tile._out.parentNode) {
                tile._out.parentNode.removeChild(tile._out);
            }
            tile._out = null;
        }
        tile._inbound = null;
    }

    function unlockRemoteAudio() {
        remoteSoundReady = true;
        useCallAudioSession();
        if (notifyCtx && notifyCtx.state === "suspended") {
            notifyCtx.resume().catch(function () {});
        }
        if (!videoGrid) {
            return;
        }
        var tiles = videoGrid.querySelectorAll(".tile");
        for (var i = 0; i < tiles.length; i++) {
            if (tiles[i].classList.contains("tile-local")) {
                continue;
            }
            var video = remoteVideoEl(tiles[i]);
            if (video) {
                applyRemotePlayback(video);
            }
        }
        hideHearHints();
    }

    function attachLocalAudioToPeers() {
        if (!localStream) {
            return;
        }
        var track = null;
        localStream.getAudioTracks().some(function (item) {
            if (item.readyState === "live") {
                track = item;
                return true;
            }
            return false;
        });
        if (!track) {
            return;
        }
        Object.keys(mapPeers).forEach(function (name) {
            var peer = mapPeers[name] && mapPeers[name][0];
            if (!peer || typeof peer.getTransceivers !== "function") {
                return;
            }
            peer.getTransceivers().forEach(function (tr) {
                var kind = "";
                if (tr.sender && tr.sender.track) {
                    kind = tr.sender.track.kind;
                } else if (tr.receiver && tr.receiver.track) {
                    kind = tr.receiver.track.kind;
                }
                if (kind !== "audio" || !tr.sender) {
                    return;
                }
                if (tr.sender.track === track) {
                    return;
                }
                try {
                    tr.sender.replaceTrack(track);
                } catch (err) {}
            });
        });
    }

    function applyLocalTrackState() {
        if (!localStream) {
            return;
        }
        var audioTracks = localStream.getAudioTracks();
        var videoTracks = localStream.getVideoTracks();
        if (audioTracks[0]) {
            audioTracks[0].enabled = audioOn;
        }
        if (videoTracks[0]) {
            videoTracks[0].enabled = videoOn;
        } else if (videoOn) {
            videoOn = false;
        }
        attachLocalAudioToPeers();
        if (localVideo) {
            localVideo.srcObject = localStream;
            localVideo.muted = true;
        }
        setTileVideoOff(localTile, !localCameraOn());
        setTileMicOff(localTile, !localMicOn());
        broadcastMediaState();
        syncMediaButtons();
    }

    function requestUserMedia() {
        return navigator.mediaDevices.getUserMedia(constraints).catch(function () {
            return navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        });
    }

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

    function clipChars(text, max) {
        var chars = Array.from(String(text == null ? "" : text));
        if (chars.length <= max) {
            return chars.join("");
        }
        return chars.slice(0, Math.max(0, max - 1)).join("") + "…";
    }

    function clipToast(text, max) {
        var value = String(text || "").replace(/\s+/g, " ").trim();
        return clipChars(value, max || 72);
    }

    function sanitizeChatBody(text) {
        var value = String(text == null ? "" : text).replace(/\r\n|\r/g, "\n");
        value = value.replace(/[\u200B-\u200D\uFEFF]/g, "");
        value = value.replace(/^\s+|\s+$/g, "");
        if (!value) {
            return "";
        }
        if (value.length > CHAT_MAX_LEN) {
            value = value.slice(0, CHAT_MAX_LEN);
        }
        return value;
    }

    function normalizeChatAt(at) {
        var n = Number(at);
        var now = Date.now();
        if (!isFinite(n) || n <= 0) {
            return now;
        }
        if (n < 1e12) {
            n *= 1000;
        }
        if (n > now + 5 * 60 * 1000) {
            return now;
        }
        return n;
    }

    function formatChatTime(at) {
        var date = new Date(normalizeChatAt(at));
        try {
            return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
        } catch (err) {
            var hours = date.getHours();
            var mins = date.getMinutes();
            return (hours < 10 ? "0" : "") + hours + ":" + (mins < 10 ? "0" : "") + mins;
        }
    }

    function pruneChatMessages() {
        if (!messageList) {
            return;
        }
        while (messageList.children.length > CHAT_MAX_ITEMS) {
            messageList.removeChild(messageList.firstChild);
        }
    }

    function clearChatMessages() {
        if (messageList) {
            messageList.textContent = "";
        }
        if (messageInput) {
            messageInput.value = "";
        }
    }

    function appendChatMessage(entry) {
        if (!messageList || !entry) {
            return;
        }
        var body = sanitizeChatBody(entry.body);
        if (!body) {
            return;
        }
        var at = normalizeChatAt(entry.at);
        var mine = !!entry.mine;
        var who = mine ? "You" : String(entry.sender || "Someone").trim() || "Someone";
        var li = document.createElement("li");
        li.className = "chat-item" + (mine ? " chat-mine" : "");
        var meta = document.createElement("div");
        meta.className = "chat-meta";
        var nameEl = document.createElement("span");
        nameEl.className = "chat-who";
        nameEl.textContent = who;
        var timeEl = document.createElement("time");
        timeEl.className = "chat-time";
        timeEl.dateTime = new Date(at).toISOString();
        timeEl.textContent = formatChatTime(at);
        meta.appendChild(nameEl);
        meta.appendChild(timeEl);
        var textEl = document.createElement("p");
        textEl.className = "chat-body";
        textEl.textContent = body;
        li.appendChild(meta);
        li.appendChild(textEl);
        messageList.appendChild(li);
        pruneChatMessages();
        scrollChatToEnd();
    }

    function receiveChat(data, peerUsername) {
        if (!data || sessionDead || !inCall) {
            return;
        }
        var body = sanitizeChatBody(data.body);
        if (!body) {
            return;
        }
        var sender = String(data.sender || peerUsername || "").trim();
        if (sender && sameName(sender, username)) {
            return;
        }
        appendChatMessage({
            mine: false,
            sender: sender || "Someone",
            body: body,
            at: data.at
        });
        if (isChatOpen()) {
            return;
        }
        unreadChat += 1;
        renderChatBadge();
        showToast(clipToast((sender || "Someone") + ": " + body), { chat: true, sound: "chat" });
    }

    function isEmojiPanelOpen() {
        return !!(emojiPanel && !emojiPanel.hidden);
    }

    function hideEmojiPanel() {
        if (emojiPanel) {
            emojiPanel.hidden = true;
        }
        if (btnEmoji) {
            btnEmoji.setAttribute("aria-expanded", "false");
        }
    }

    function showEmojiPanel() {
        if (!emojiPanel) {
            return;
        }
        emojiPanel.hidden = false;
        if (btnEmoji) {
            btnEmoji.setAttribute("aria-expanded", "true");
        }
    }

    function toggleEmojiPanel() {
        if (isEmojiPanelOpen()) {
            hideEmojiPanel();
            return;
        }
        showEmojiPanel();
    }

    function insertEmoji(emoji) {
        if (!messageInput || !emoji || sessionDead) {
            return;
        }
        var max = messageInput.maxLength > 0 ? messageInput.maxLength : CHAT_MAX_LEN;
        var value = messageInput.value || "";
        var start = messageInput.selectionStart;
        var end = messageInput.selectionEnd;
        if (typeof start !== "number" || typeof end !== "number") {
            start = value.length;
            end = value.length;
        }
        var next = value.slice(0, start) + emoji + value.slice(end);
        if (next.length > max) {
            return;
        }
        messageInput.value = next;
        var caret = start + emoji.length;
        try {
            messageInput.setSelectionRange(caret, caret);
        } catch (err) {}
        messageInput.focus();
    }

    function bindEmojiPicker() {
        if (!emojiPanel || emojiPanel.dataset.bound === "1") {
            return;
        }
        emojiPanel.dataset.bound = "1";
        CHAT_EMOJIS.forEach(function (emoji) {
            var btn = document.createElement("button");
            btn.type = "button";
            btn.className = "emoji-choice";
            btn.textContent = emoji;
            btn.setAttribute("aria-label", "Insert " + emoji);
            btn.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                insertEmoji(emoji);
            });
            emojiPanel.appendChild(btn);
        });
        if (btnEmoji) {
            btnEmoji.addEventListener("click", function (event) {
                event.preventDefault();
                event.stopPropagation();
                toggleEmojiPanel();
            });
        }
        document.addEventListener("pointerdown", function (event) {
            if (!isEmojiPanelOpen()) {
                return;
            }
            var target = event.target;
            if (emojiPanel.contains(target) || (btnEmoji && btnEmoji.contains(target))) {
                return;
            }
            hideEmojiPanel();
        });
        document.addEventListener("keydown", function (event) {
            if (event.key === "Escape") {
                hideEmojiPanel();
            }
        });
    }

    function ensureLocalMedia() {
        if (hasLiveMedia()) {
            return Promise.resolve(localStream);
        }
        mediaReady = null;
        if (!mediaSupported()) {
            return Promise.reject(new Error("no-media"));
        }
        mediaReady = requestUserMedia()
            .then(function (stream) {
                if (sessionDead) {
                    stream.getTracks().forEach(function (track) { track.stop(); });
                    throw new Error("Session ended before media started.");
                }
                localStream = stream;
                applyLocalTrackState();
                return stream;
            })
            .catch(function (err) {
                mediaReady = null;
                throw err;
            });
        return mediaReady;
    }

    function ensureAudioTrack() {
        if (localStream && localStream.getAudioTracks().some(function (track) {
            return track.readyState === "live";
        })) {
            return Promise.resolve(localStream);
        }
        if (!mediaSupported()) {
            return Promise.reject(new Error("no-media"));
        }
        return navigator.mediaDevices.getUserMedia({ audio: true, video: false }).then(function (stream) {
            stream.getAudioTracks().forEach(function (track) {
                localStream.addTrack(track);
            });
            applyLocalTrackState();
            return localStream;
        });
    }

    function toggleAudio() {
        unlockRemoteAudio();
        if (audioOn && localStream && localStream.getAudioTracks()[0]) {
            audioOn = false;
            applyLocalTrackState();
            return;
        }
        audioOn = true;
        syncMediaButtons();
        useCallAudioSession();
        ensureLocalMedia()
            .then(ensureAudioTrack)
            .then(function () {
                applyLocalTrackState();
            })
            .catch(function () {
                audioOn = false;
                syncMediaButtons();
                showToast(mediaErrorMessage());
            });
    }

    function toggleVideo() {
        unlockRemoteAudio();
        if (videoOn && hasLiveMedia() && localStream.getVideoTracks()[0]) {
            videoOn = false;
            applyLocalTrackState();
            return;
        }
        videoOn = true;
        syncMediaButtons();
        ensureLocalMedia()
            .then(function () {
                applyLocalTrackState();
            })
            .catch(function () {
                videoOn = false;
                setTileVideoOff(localTile, true);
                syncMediaButtons();
                broadcastMediaState();
                showToast(mediaErrorMessage());
            });
    }

    function bindMediaControls() {
        if (mediaControlsBound) {
            return;
        }
        mediaControlsBound = true;
        if (btnToggleAudio) {
            btnToggleAudio.addEventListener("click", toggleAudio);
        }
        if (btnToggleVideo) {
            btnToggleVideo.addEventListener("click", toggleVideo);
        }
        if (callBar) {
            callBar.addEventListener("pointerdown", unlockRemoteAudio);
        }
        if (callLayout) {
            callLayout.addEventListener("pointerdown", unlockRemoteAudio);
        }
    }

    if (btnSendMsg) {
        btnSendMsg.addEventListener("click", sendMsgOnClick);
    }
    if (messageInput) {
        messageInput.addEventListener("keydown", function (event) {
            if (event.key !== "Enter" || event.shiftKey || event.isComposing || event.keyCode === 229) {
                return;
            }
            event.preventDefault();
            sendMsgOnClick();
        });
    }
    bindEmojiPicker();

    function sendMsgOnClick() {
        if (!messageInput || sessionDead || !inCall) {
            return;
        }
        var message = sanitizeChatBody(messageInput.value);
        if (!message) {
            return;
        }
        var at = Date.now();
        appendChatMessage({
            mine: true,
            sender: username,
            body: message,
            at: at
        });
        var outbound = MEDIA_PREFIX + JSON.stringify({
            t: "chat",
            body: message,
            at: at,
            sender: username || "Someone"
        });
        getDataChannels().forEach(function (channel) {
            if (channel && channel.readyState === "open") {
                try {
                    channel.send(outbound);
                } catch (err) {}
            }
        });
        messageInput.value = "";
        hideEmojiPanel();
        messageInput.focus();
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

    function setTileMicOff(tile, off) {
        if (!tile) {
            return;
        }
        var mic = tile.querySelector(".tile-mic");
        if (!mic) {
            return;
        }
        mic.classList.toggle("is-off", !!off);
        mic.title = off ? "Microphone off" : "Microphone on";
        mic.setAttribute("aria-label", mic.title);
    }

    function ensureTileChrome(tile, name) {
        if (!tile) {
            return null;
        }
        var chrome = tile.querySelector(".tile-chrome");
        var label = tile.querySelector(".tile-name");
        if (!chrome) {
            chrome = document.createElement("div");
            chrome.className = "tile-chrome";
            var mic = document.createElement("span");
            mic.className = "tile-mic is-off";
            mic.innerHTML = MIC_ICON_HTML;
            chrome.appendChild(mic);
            if (label) {
                chrome.appendChild(label);
            } else {
                label = document.createElement("span");
                label.className = "tile-name";
                label.textContent = name || "";
                chrome.appendChild(label);
            }
            tile.appendChild(chrome);
        } else if (!tile.querySelector(".tile-mic")) {
            var micIcon = document.createElement("span");
            micIcon.className = "tile-mic is-off";
            micIcon.innerHTML = MIC_ICON_HTML;
            chrome.insertBefore(micIcon, chrome.firstChild);
        }
        setTileMicOff(tile, true);
        return chrome;
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

    function watchAudioTrack(tile, track, peerUsername) {
        if (!tile || !track) {
            return;
        }
        tile._audioWatched = tile._audioWatched || {};
        if (tile._audioWatched[track.id]) {
            return;
        }
        function onUnmute() {
            if (!remoteSoundReady) {
                showHearHint(tile);
            }
        }
        function onEnded() {
            if (tile._inbound) {
                try {
                    tile._inbound.removeTrack(track);
                } catch (err) {}
            }
            if (typeof tile._audioWatched[track.id] === "function") {
                tile._audioWatched[track.id]();
                delete tile._audioWatched[track.id];
            }
        }
        track.addEventListener("unmute", onUnmute);
        track.addEventListener("ended", onEnded);
        tile._audioWatched[track.id] = function () {
            track.removeEventListener("unmute", onUnmute);
            track.removeEventListener("ended", onEnded);
        };
        if (!remoteSoundReady) {
            showHearHint(tile);
        }
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
            remoteVideo.srcObject = null;
            removevideo(remoteVideo);
        }
        delete remoteVideoDesired[key];
        delete remoteVideoDesired[peerUsername];
        delete remoteAudioDesired[key];
        delete remoteAudioDesired[peerUsername];
        delete iceQueues[key];
        delete iceQueues[nameKey(peerUsername)];
        if (sameName(pinnedPeer, key) || sameName(pinnedPeer, peerUsername)) {
            pinnedPeer = "";
        }
        updateGridLayout();
    }

    var ICE_QUEUE_MAX = 64;

    function rtcPeerConfig() {
        var servers = Array.isArray(roomConfig.iceServers) ? roomConfig.iceServers : [];
        var clean = [];
        for (var i = 0; i < servers.length; i++) {
            var item = servers[i];
            if (!item || typeof item !== "object") {
                continue;
            }
            var urls = item.urls;
            if (!urls || (Array.isArray(urls) && !urls.length)) {
                continue;
            }
            var entry = { urls: urls };
            if (item.username && item.credential) {
                entry.username = String(item.username);
                entry.credential = String(item.credential);
            }
            clean.push(entry);
        }
        if (!clean.length) {
            return {};
        }
        return { iceServers: clean };
    }

    function iceKey(name) {
        return nameKey(name) || name;
    }

    function candidateInit(candidate) {
        if (!candidate) {
            return null;
        }
        var init;
        if (typeof candidate.toJSON === "function") {
            init = candidate.toJSON();
        } else {
            init = {
                candidate: candidate.candidate,
                sdpMid: candidate.sdpMid,
                sdpMLineIndex: candidate.sdpMLineIndex,
                usernameFragment: candidate.usernameFragment,
            };
        }
        if (!init || !init.candidate) {
            return null;
        }
        if (init.sdpMid == null && init.sdpMLineIndex == null) {
            return null;
        }
        return init;
    }

    function applyIceCandidate(peer, candidate) {
        if (!peer || !candidate || !candidate.candidate || peer.signalingState === "closed") {
            return;
        }
        try {
            var add = peer.addIceCandidate(candidate);
            if (add && typeof add.catch === "function") {
                add.catch(function () {});
            }
        } catch (err) {}
    }

    function queueOrAddIce(peerUsername, candidate) {
        if (sessionDead || !candidate || !candidate.candidate) {
            return;
        }
        var key = iceKey(peerUsername);
        var entry = mapPeers[resolvePeerKey(peerUsername)];
        var peer = entry && entry[0];
        if (peer && peer.remoteDescription && peer.remoteDescription.type) {
            applyIceCandidate(peer, candidate);
            return;
        }
        if (!iceQueues[key]) {
            iceQueues[key] = [];
        }
        iceQueues[key].push(candidate);
        if (iceQueues[key].length > ICE_QUEUE_MAX) {
            iceQueues[key].splice(0, iceQueues[key].length - ICE_QUEUE_MAX);
        }
    }

    function flushIceQueue(peerUsername) {
        var key = iceKey(peerUsername);
        var queued = iceQueues[key] || [];
        delete iceQueues[key];
        var entry = mapPeers[resolvePeerKey(peerUsername)];
        var peer = entry && entry[0];
        queued.forEach(function (candidate) {
            applyIceCandidate(peer, candidate);
        });
    }

    function bindIceTrickle(peer, peerUsername, receiver) {
        peer._signalTo = receiver;
        peer.addEventListener("icecandidate", function (event) {
            if (!event.candidate || !isCurrentPeer(peer, peerUsername) || sessionDead || !peer._signalTo) {
                return;
            }
            var init = candidateInit(event.candidate);
            if (!init) {
                return;
            }
            sendSignal("ice-candidate", {
                receiver_channel_name: peer._signalTo,
                candidate: init,
            });
        });
    }

    function createOfferer(peerUsername, receiver_channel_name) {
        if (!peerUsername || !receiver_channel_name || sessionDead || sameName(peerUsername, username)) {
            return;
        }
        if (mapPeers[resolvePeerKey(peerUsername)]) {
            cleanupPeer(peerUsername);
        }
        var peer = new RTCPeerConnection(rtcPeerConfig());
        addLocalTracks(peer);
        var dc = peer.createDataChannel("channel");
        bindDataChannel(dc, peerUsername);
        var remoteVideo = createVideo(peerUsername);
        setOnTrack(peer, remoteVideo);
        mapPeers[peerUsername] = [peer, dc];
        watchIce(peer, peerUsername, remoteVideo);
        bindIceTrickle(peer, peerUsername, receiver_channel_name);
        peer.createOffer()
            .then(function (offer) {
                if (sessionDead || !isCurrentPeer(peer, peerUsername)) {
                    return;
                }
                return peer.setLocalDescription(offer);
            })
            .then(function () {
                if (sessionDead || !isCurrentPeer(peer, peerUsername) || !peer.localDescription) {
                    return;
                }
                sendSignal("new-offer", {
                    sdp: peer.localDescription,
                    receiver_channel_name: receiver_channel_name,
                });
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
        var peer = new RTCPeerConnection(rtcPeerConfig());
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
        bindIceTrickle(peer, peerUsername, receiver_channel_name);
        peer.setRemoteDescription(offer)
            .then(function () {
                if (sessionDead || !isCurrentPeer(peer, peerUsername)) {
                    return;
                }
                addLocalTracks(peer);
                flushIceQueue(peerUsername);
                return peer.createAnswer();
            })
            .then(function (answer) {
                if (!answer || sessionDead || !isCurrentPeer(peer, peerUsername)) {
                    return;
                }
                return peer.setLocalDescription(answer);
            })
            .then(function () {
                if (sessionDead || !isCurrentPeer(peer, peerUsername) || !peer.localDescription) {
                    return;
                }
                sendSignal("new-answer", {
                    sdp: peer.localDescription,
                    receiver_channel_name: receiver_channel_name,
                });
            })
            .catch(function (error) { console.log("Error in answerer:", error); });
    }

    function watchIce(peer, peerUsername, remoteVideo) {
        peer.addEventListener("iceconnectionstatechange", function () {
            var iceConnectionState = peer.iceConnectionState;
            if (iceConnectionState === "connected" || iceConnectionState === "completed") {
                window.clearTimeout(peer._iceDropTimer);
                peer._iceRestarted = false;
                return;
            }
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
            if (iceConnectionState === "failed" && !peer._iceRestarted && typeof peer.restartIce === "function") {
                peer._iceRestarted = true;
                try {
                    peer.restartIce();
                } catch (err) {
                    cleanupPeer(peerUsername);
                }
                return;
            }
            cleanupPeer(peerUsername);
        });
    }

    function addLocalTracks(peer) {
        var audio = localStream.getAudioTracks()[0] || null;
        var video = localStream.getVideoTracks()[0] || null;
        var transceivers = peer.getTransceivers();
        if (!transceivers.length) {
            if (audio) {
                peer.addTrack(audio, localStream);
            }
            if (video) {
                peer.addTrack(video, localStream);
            }
            return;
        }
        transceivers.forEach(function (tr, index) {
            var kind = "";
            if (tr.receiver && tr.receiver.track) {
                kind = tr.receiver.track.kind;
            } else if (tr.sender && tr.sender.track) {
                kind = tr.sender.track.kind;
            } else if (index === 0) {
                kind = "audio";
            } else if (index === 1) {
                kind = "video";
            }
            var track = kind === "audio" ? audio : kind === "video" ? video : null;
            if (!track || !tr.sender) {
                return;
            }
            try {
                tr.sender.replaceTrack(track);
                if (tr.direction === "recvonly" || tr.direction === "inactive") {
                    tr.direction = "sendrecv";
                }
            } catch (err) {
                peer.addTrack(track, localStream);
            }
        });
    }

    function dcOnMessage(event) {
        if (!messageList || sessionDead || !inCall) {
            return;
        }
        if (typeof (event && event.data) !== "string") {
            return;
        }
        var raw = event.data;
        if (!raw || raw.indexOf(MEDIA_PREFIX) === 0) {
            return;
        }
        var parsed = parseChatLine(raw);
        receiveChat({
            sender: parsed.sender,
            body: parsed.body || raw,
            at: Date.now()
        }, parsed.sender);
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
        remoteVideo.muted = true;
        remoteVideo.defaultMuted = true;
        remoteVideo.setAttribute("playsinline", "");
        remoteVideo.setAttribute("webkit-playsinline", "");
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
        ensureTileChrome(tile, peerUsername);
        tile.addEventListener("pointerdown", unlockRemoteAudio);
        showHearHint(tile);
        videoGrid.appendChild(tile);
        bindPinButton(pin);
        updateGridLayout();
        var stored = {};
        if (Object.prototype.hasOwnProperty.call(remoteVideoDesired, peerUsername)) {
            stored.video = remoteVideoDesired[peerUsername];
        }
        if (Object.prototype.hasOwnProperty.call(remoteAudioDesired, peerUsername)) {
            stored.audio = remoteAudioDesired[peerUsername];
        }
        if (Object.keys(stored).length) {
            applyRemoteMedia(peerUsername, stored);
        } else {
            setTileMicOff(tile, true);
        }
        return remoteVideo;
    }

    function setOnTrack(peer, remoteVideo) {
        var tile = remoteVideo.closest ? remoteVideo.closest(".tile") : remoteVideo.parentNode;
        peer.addEventListener("track", function (event) {
            if (!tile) {
                tile = remoteVideo.closest ? remoteVideo.closest(".tile") : remoteVideo.parentNode;
            }
            var peerName = tile && tile.dataset ? tile.dataset.peer : "";
            if (!event || !tile || !isCurrentPeer(peer, peerName)) {
                return;
            }
            var inbound = mergeInbound(tile, peer, event);
            attachRemoteStream(remoteVideo, inbound);
            if (event.track && event.track.kind === "video") {
                watchVideoTrack(tile, event.track, remoteVideo, peerName);
            }
            if (event.track && event.track.kind === "audio") {
                watchAudioTrack(tile, event.track, peerName);
            } else if (!remoteSoundReady) {
                showHearHint(tile);
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
        disposeTileAudio(tile);
        if (tile && tile.parentNode && !tile.classList.contains("tile-local")) {
            tile.parentNode.removeChild(tile);
            updateGridLayout();
        }
    }

    if (localTile) {
        bindPinButton(localTile.querySelector(".tile-pin"));
        setTileLetter(localTile, "You");
        ensureTileChrome(localTile, "You");
        setTileVideoOff(localTile, true);
        setTileMicOff(localTile, true);
        updateGridLayout();
    }
    bindMediaControls();
    syncMediaButtons();
    renderChatBadge();
    document.addEventListener("pointerdown", function () {
        unlockNotifySound();
        if (inCall) {
            unlockRemoteAudio();
        }
    }, true);
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
