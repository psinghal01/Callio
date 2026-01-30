//mapPeers: Stores all peer connections
//Structure: {'username':[RTCPeerConnection(for audio and video), DataChannel(message)] }
var mapPeers = {};

// DOM Elements for user input
var usernameInput = document.querySelector('#username');
var btnJoin = document.querySelector('#btn-join');

// User information
var username;
// WebSocket connection for signaling
var webSocket;

//Handles incoming WebSocket messages from the server
//Messages contain signaling data for WebRTC connections
function webSocketOnMessage(event){
    var parseData = JSON.parse(event.data);
    var peerUsername = parseData['peer'];
    var action = parseData['action'];

    // Ignore messages from ourselves
    if (username == peerUsername){
        return;
    }
    // Get the channel name for sending responses back to this peer
    var receiver_channel_name = parseData['message']['receiver_channel_name']
    // NEW-PEER: A new user joined the room
    if (action == 'new-peer'){
        createOfferer(peerUsername, receiver_channel_name);
        return;
    }
    // NEW-OFFER: Received a connection offer from another peer
    if(action == "new-offer"){
        var offer = parseData['message']['sdp']; // SDP = Session Description Protocol
        createAnswerer(offer, peerUsername, receiver_channel_name);
    }
    // NEW-ANSWER: Received an answer to our connection offer
    if(action == "new-answer"){
        var answer = parseData['message']['sdp'];
        var peer = mapPeers[peerUsername][0]; // Get the RTCPeerConnection object
        peer.setRemoteDescription(answer); // Complete the connection
        return;
    }
}

//Event listener for Join Room button
//Initializes WebSocket connection and sets up the room
btnJoin.addEventListener('click', () => {
    username = usernameInput.value;
    console.log(username);
   
    if(username == "" || username.trim() == ""){
        return;
    }
    // Clear and disable the input field
    usernameInput.value = "";
    usernameInput.disabled = true;
    usernameInput.style.visibility = 'hidden';
    // Hide the join button
    btnJoin.disabled = true;
    btnJoin.style.visibility = 'hidden';
    // Display username on page
    var labelUsername = document.querySelector('#label-username');
    labelUsername.innerHTML = username;

    // Determine WebSocket protocol based on current page protocol
    var loc = window.location;
    var wsStart = 'ws://';

    if (loc.protocol == 'https:'){
        wsStart = 'wss://'
    }
    // Build WebSocket endpoint URL
    var endPoint = wsStart + loc.host + loc.pathname;
    console.log(endPoint)

    // Create WebSocket connection
    webSocket = new WebSocket(endPoint);
    webSocket.addEventListener('open', (e) => {
        console.log('Connection Opened');
        sendSignal('new-peer', {});
    });
    webSocket.addEventListener('message', webSocketOnMessage);
    webSocket.addEventListener('close', (e) => {
        console.log('Connection Closed');
    });
    webSocket.addEventListener('error', (e) => {
        console.log('Error Occured');
    });
});

// LOCAL MEDIA STREAM SETUP
var localStream = new MediaStream();
const constraints = {
    'video': true,
    'audio': true
}
// DOM elements for local video and controls
const localVideo = document.querySelector('#local-video');
const btnToggleAudio = document.querySelector('#btn-toggle-audio');
const btnToggleVideo = document.querySelector('#btn-toggle-video');

//Request access to user's camera and microphone
//This will prompt the user for permission
var userMedia = navigator.mediaDevices.getUserMedia(constraints)
    .then(stream => {
        // Store the media stream
        localStream = stream;

        localVideo.srcObject = localStream;
        localVideo.muted = true;

        // Get individual tracks
        var audioTracks = stream.getAudioTracks();
        var videoTracks = stream.getVideoTracks();
        // Enable both tracks by default
        audioTracks[0].enabled = true;
        videoTracks[0].enabled = true;

        btnToggleAudio.addEventListener('click', () => {
            // Toggle audio on/off
            audioTracks[0].enabled = !audioTracks[0].enabled;

            if(audioTracks[0].enabled){
                btnToggleAudio.innerHTML = 'Audio Mute';
                return;
            }

            btnToggleAudio.innerHTML = 'Audio Unmute';
        });

        btnToggleVideo.addEventListener('click', () => {
            // Toggle video on/off
            videoTracks[0].enabled = !videoTracks[0].enabled;

            if(videoTracks[0].enabled){
                btnToggleVideo.innerHTML = 'Video Off';
                return;
            }

            btnToggleVideo.innerHTML = 'Video On';
        });
    })
    .catch(error => {
        console.log('Error accessing media devices.', error)
    })

// CHAT FUNCTIONALITY
// DOM elements for chat
var btnSendMsg = document.querySelector('#btn-send-msg');
var messageList = document.querySelector('#message-list');
var messageInput = document.querySelector('#msg');

// Send message when button is clicked
btnSendMsg.addEventListener('click', sendMsgOnClick);

function sendMsgOnClick(){
    var message = messageInput.value;

    // Display message in own chat window
    var li = document.createElement('li');
    li.appendChild(document.createTextNode('Me: ' + message));
    messageList.appendChild(li);

    var datachannel = getDataChannels();
    message = username + ": " + message;

    // Send message through all data channels
    for (index in datachannel){
        datachannel[index].send(message);
    }

    messageInput.value = '';
}

//Sends a signaling message through WebSocket
//Used to coordinate WebRTC connections
function sendSignal(action, message){
    var jsonStr = JSON.stringify({
        'peer': username,
        'action': action,
        'message': message,
    });
    webSocket.send(jsonStr);
}
   
//Creates a peer connection and sends an offer
//Called when we want to connect to a new peer
function createOfferer(peerUsername, receiver_channel_name){
    // null = use default configuration (for local network)
    var peer = new RTCPeerConnection(null);
    // Add our video/audio tracks to the connection
    addLocalTracks(peer);

    var dc = peer.createDataChannel('channel');

    dc.addEventListener('open', () => {
        console.log('Connection Open');
    });

    dc.addEventListener('message', dcOnMessage);

    // Create video element to display remote peer's video
    var remoteVideo = createVideo(peerUsername);
    setOnTrack(peer, remoteVideo);

    // Store the peer connection and data channel
    mapPeers[peerUsername] = [peer, dc];
    
    // Monitor ICE connection state
    //ICE = Interactive Connectivity Establishment
    //Handles NAT traversal and connection setup
    peer.addEventListener('iceconnectionstatechange', () => {
        var iceConnectionState = peer.iceConnectionState;

        if (iceConnectionState === 'failed' || iceConnectionState === 'disconnected' || iceConnectionState === 'closed'){
            delete mapPeers[peerUsername];

            if (iceConnectionState != "closed"){
                peer.close();
            }

            removevideo(remoteVideo);
        }
    });

    // ICE CANDIDATE HANDLING
    peer.addEventListener('icecandidate', (event) => {
        // Still gathering candidates, not ready to send offer yet
        if(event.candidate){
            console.log('New ICE candidate:', JSON.stringify(peer.localDescription));
            return;
        }
        // All candidates gathered, send the complete offer
        sendSignal('new-offer', {
            'sdp': peer.localDescription,
            'receiver_channel_name': receiver_channel_name
        });
    });
    
    // CREATE AND SEND OFFER
    peer.createOffer()
        .then(o => peer.setLocalDescription(o))
        .then(() => {
            console.log("Local description set successfully");
        })
        .catch(error => {
            console.log('Error creating offer:', error)
        })
}

// CREATE ANSWERER (Responds to Connection)
function createAnswerer(offer, peerUsername, receiver_channel_name){

    var peer = new RTCPeerConnection(null); 

    addLocalTracks(peer);

    var remoteVideo = createVideo(peerUsername);
    setOnTrack(peer, remoteVideo);

    peer.addEventListener('datachannel', e => {
        peer.dc = e.channel;

        peer.dc.addEventListener('open', () => {
            console.log('Connection Open');
        });

        peer.dc.addEventListener('message', dcOnMessage);

        mapPeers[peerUsername] = [peer, peer.dc];
    })
    
    // ICE CONNECTION STATE MONITORING
    peer.addEventListener('iceconnectionstatechange', () => {

        var iceConnectionState = peer.iceConnectionState;

        if (iceConnectionState === 'failed' || iceConnectionState === 'disconnected' || iceConnectionState === 'closed'){
            delete mapPeers[peerUsername];

            if (iceConnectionState != "closed"){
                peer.close();
            }

            removevideo(remoteVideo);
        }
    });

    peer.addEventListener('icecandidate', (event) => {

        if(event.candidate){
            console.log('New ICE candidate:', JSON.stringify(peer.localDescription));
            return;
        }

        sendSignal('new-answer', {
            'sdp': peer.localDescription,
            'receiver_channel_name': receiver_channel_name
        });
    });
    
    // SET REMOTE DESCRIPTION AND CREATE ANSWER
    peer.setRemoteDescription(offer)
        .then(() => {
            console.log("Remote description set successfully for:", peerUsername);
            return peer.createAnswer();
        })
        .then(a => {
            console.log("Answer created");
            peer.setLocalDescription(a);
        })
        .catch(error => {
            console.log('Error in answerer:', error);
        });
}

// HELPER FUNCTIONS

function addLocalTracks(peer){
    localStream.getTracks().forEach(track => {
        peer.addTrack(track, localStream);
    });
    return;
}

function dcOnMessage(event){
    var message = event.data;
    var li = document.createElement('li');
    li.appendChild(document.createTextNode(message));
    messageList.appendChild(li);
}

function createVideo(peerUsername){
    var videoContainer = document.querySelector("#video-container");
    var remoteVideo = document.createElement('video');
    remoteVideo.id = peerUsername + '-video';
    remoteVideo.autoplay = true;
    remoteVideo.playsInline = true;

    var VideoWrapper = document.createElement('div');
    videoContainer.appendChild(VideoWrapper);
    VideoWrapper.appendChild(remoteVideo);
    return remoteVideo;
}

function setOnTrack(peer, remoteVideo){
    var remoteStream = new MediaStream();
    remoteVideo.srcObject = remoteStream;
    peer.addEventListener('track', async(event) => {
        remoteStream.addTrack(event.track, remoteStream);
    });
}

function removevideo(video){
    var VideoWrapper = video.parentNode;
    VideoWrapper.parentNode.removeChild(VideoWrapper);
}

function getDataChannels(){
    var dataChannels = [];
    for (peerUsername in mapPeers){
        var dataChannel = mapPeers[peerUsername][1];
        dataChannels.push(dataChannel);
    }
    return dataChannels;
}
