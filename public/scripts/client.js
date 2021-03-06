const socket = io.connect();
function readOnly(obj) {
    this.get = () => { return obj; }
}

let key = new readOnly(document.getElementsByClassName("getSessionKey")[0].innerHTML);
document.getElementsByClassName("getSessionKey")[0].remove();

let beforeunload = false;

window.onbeforeunload = () => {
    beforeunload = true;
    if(socket.connected) socket.disconnect();
}

socket.on("connect", () => {
    socket.emit("session", key.get());
    key = undefined;
    setInterval(() => {
		socket.emit("alive");
		console.log("alive");
	}, 10000);
});

socket.on("disconnect", () => {
    if(!beforeunload) {
        alertM("서버 연결이 중단되었습니다.").then(() => {
            location.reload();
        });
    }
});

socket.on("serverError", id => {
    closeState();
    document.getElementsByClassName("live_room")[0].style.display = "none";
    document.getElementsByClassName("right_side")[0].style.display = "none";
    beforeunload = true;
    switch(id) {
        case 1:
            alertM("다른 브라우저에서 접속중입니다."); break;
        case 2:
            alertM("존재하지 않는 키값입니다."); break;
        case 3:
            alertM("로그인을 해주세요").then(() => {
                location.href = "/edu/member/login/live";
            });
			break;
        case 4:
            alertM("계정이 사용중입니다."); break;
    }
});

socket.on("callClose", () => {
    closeState();
    beforeunload = true;
    document.getElementsByClassName("live_room")[0].style.display = "none";
    document.getElementsByClassName("right_side")[0].style.display = "none";
    alertM("통화가 종료되었습니다.").then(() => {
        window.close();
        history.back();
    });
});

socket.on("createToken", token => {
    const clip = document.createElement("textarea");
    clip.value = `${window.location.protocol}//${window.location.hostname}/live/${token}`;
    document.body.appendChild(clip);
    clip.select();
    clip.setSelectionRange(0, 9999);

    document.execCommand("copy");
    document.body.removeChild(clip);
    promptM("복사되었습니다.", `${window.location.protocol}//${window.location.hostname}/live/${token}`);
});

socket.on("serverMsg", packet => {
    switch(packet.id) {
        case 1:
            alertM(packet.message);
            break;
    }
});

socket.on("JoinRoom", (uid, name) => {
    userBoxCreate(uid, name);
});

socket.on("PlayerConnection", (uid, name) => {
    userBoxCreate(uid, name);
    if(!peers[uid]) peers[uid] = createPeerConnection();
    peers[uid].socketId = uid;
    doCall(peers[uid], uid);

    if(callState.audio)
        socket.emit("audioStatus", { status: callState.audio, streamId: devices["Audio"].id}, uid);

    if(callState.video)
        socket.emit("videoStatus", { status: callState.video, streamId: devices["Video"].id }, uid);

    if(callState.desktop)
        socket.emit("desktopStatus", { status: callState.desktop, streamId: devices["DesktopShare"].id }, uid);
});

socket.on("PlayerDisconnection", uid => {
    userCamVideoDelete(uid);
    userAudioDelete(uid);
    userDesktopVideoDelete(uid);
    userDesktopAudioDelete(uid);
    userBoxDelete(uid);

    if(peers[uid]) {
        peers[uid].close();
        delete peers[uid];
    }
});

socket.on("RTCConnection", (uid, name) => {
    if(!document.getElementsByClassName("container_room")[0].firstElementChild.getElementsByClassName(`containerbox_${uid}`)) userBoxCreate(uid, name);
    if(!peers[uid]) peers[uid] = createPeerConnection();
    peers[uid].socketId = uid;
    doCall(peers[uid], uid);
});

socket.on("RTCData", (message, to, name)=>{
    if(message.type === "offer"){
        userBoxCreate(to, name);
        if(!peers[to]) peers[to] = createPeerConnection();
        peers[to].setRemoteDescription(new RTCSessionDescription(message));
        doAnswer(peers[to], to);
        peers[to].socketId = to;
    }else if(message.type ==="answer" && peers[to]) {
        peers[to].setRemoteDescription(new RTCSessionDescription(message));
    }else if(message.type ==="candidate" && peers[to]) {
        const candidate = new RTCIceCandidate({
            sdpMLineIndex : message.label,
            candidate:message.candidate
        });
        
        peers[to].addIceCandidate(candidate);
    }
});

socket.on("audioStatus", data => {
    if(data.uid == socket.id) return;

    if(!data.status) {
        userAudioDelete(data.uid);
        
        if(worker[data.uid+"_"+data.streamId+"_audio"])
            delete worker[data.uid+"_"+data.streamId+"_audio"];
        return;
    }

    if(!peers[data.uid]) {
        worker[data.uid+"_"+data.streamId+"_audio"] = { uid: data.uid, streamId: data.streamId, count: 0 };
        return;
    }

    audioStatusChange(data.streamId, data.uid);
});

socket.on("desktopStatus", data => {
    if(data.uid == socket.id) return;
    if(!data.status) {
        userDesktopVideoDelete(data.uid);
        userDesktopAudioDelete(data.uid);
        if(worker[data.uid+"_"+data.streamId+"_desktop"])
            delete worker[data.uid+"_"+data.streamId+"_desktop"];
        return;
    }

    if(!peers[data.uid]) {
        worker[data.uid+"_"+data.streamId+"_desktop"] = { uid: data.uid, streamId: data.streamId, count: 0 };
        return;
    }

    desktopStatusChange(data.streamId, data.uid);
});

socket.on("videoStatus", data => {
    if(data.uid == socket.id) return;
    if(!data.status) {
        userCamVideoDelete(data.uid);
        return;
    }

    if(!peers[data.uid]) {
        worker[data.uid+"_"+data.streamId+"_video"] = { uid: data.uid, streamId: data.streamId, count: 0 };
        return;
    }

    videoStatusChange(data.streamId, data.uid);
});

socket.on("chat", packet => {
    packet = JSON.parse(packet);
    const msgbox = document.createElement("div");
    msgbox.setAttribute("class", `send_${packet.sender} chatbox`);

    const info = document.createElement("div");
    info.setAttribute("class", "chatbox_top");

    const sender = document.createElement("span");
    sender.setAttribute("class", "chatbox_sender");
    sender.innerText = packet.name;

    const time = document.createElement("span");
    time.setAttribute("class", "chatbox_time");
    time.innerText = packet.time;

    info.appendChild(sender);
    info.appendChild(time);

    const msg = document.createElement("div");
    msg.setAttribute("class", "chatbox_msg");
    msg.innerHTML = packet.msg;

    msgbox.appendChild(info);
    msgbox.appendChild(msg);

    const autoScroll = document.getElementsByClassName("chatlistbox")[0].scrollTop >= document.getElementsByClassName("chatlistbox")[0].scrollHeight - document.getElementsByClassName("chatlistbox")[0].offsetHeight - 100;
    document.getElementsByClassName("chatlistbox")[0].appendChild(msgbox);
    if(autoScroll) {
        document.getElementsByClassName("chatlistbox")[0].scrollTop = document.getElementsByClassName("chatlistbox")[0].scrollHeight;
    }
});


const audioStatusChange = (streamId, socketId) => {
    let check = false;
    for(let i = 0; i < peers[socketId].getRemoteStreams().length; i++) {
        if(peers[socketId].getRemoteStreams()[i].id == streamId) {
            if(peers[socketId].getRemoteStreams()[i].getAudioTracks().length > 0) {
                userAudioCreate(new MediaStream(peers[socketId].getRemoteStreams()[i].getAudioTracks()), socketId);
                check = true;
            }
            break;
        }
    }

    if(!check) {
        if(!worker[socketId+"_"+streamId+"_audio"])
            worker[socketId+"_"+streamId+"_audio"] = { uid: socketId, streamId: streamId, count: 0 };
        else
            worker[socketId+"_"+streamId+"_audio"].count++;
        if(worker[socketId+"_"+streamId+"_audio"].count > 5) delete worker[socketId+"_"+streamId+"_audio"];
    }else if(worker[socketId+"_"+streamId+"_audio"]) delete worker[socketId+"_"+streamId+"_audio"];
}

const desktopStatusChange = (streamId, socketId) => {
    let check = false;
    for(let i = 0; i < peers[socketId].getRemoteStreams().length; i++) {
        if(peers[socketId].getRemoteStreams()[i].id == streamId) {
            if(peers[socketId].getRemoteStreams()[i].getVideoTracks().length > 0) {
                userDesktopVideoCreate(new MediaStream(peers[socketId].getRemoteStreams()[i].getVideoTracks()), socketId);
                check = true;
            }
            if(peers[socketId].getRemoteStreams()[i].getAudioTracks().length > 0) {
                userDesktopAudioCreate(new MediaStream(peers[socketId].getRemoteStreams()[i].getAudioTracks()), socketId);
                check = true;
            }
            break;
        }
    }

    if(!check) {
        if(!worker[socketId+"_"+streamId+"_desktop"])
            worker[socketId+"_"+streamId+"_desktop"] = { uid: socketId, streamId: streamId, count: 0 };
        else
            worker[socketId+"_"+streamId+"_desktop"].count++;
        if(worker[socketId+"_"+streamId+"_desktop"].count > 5) delete worker[socketId+"_"+streamId+"_desktop"];
    }else if(worker[socketId+"_"+streamId+"_desktop"]) delete worker[socketId+"_"+streamId+"_desktop"];
}

const videoStatusChange = (streamId, socketId) => {
    let check = false;
    for(let i = 0; i < peers[socketId].getRemoteStreams().length; i++) {
        if(peers[socketId].getRemoteStreams()[i].id == streamId) {
            if(peers[socketId].getRemoteStreams()[i].getVideoTracks().length > 0) {
                userCamVideoCreate(new MediaStream(peers[socketId].getRemoteStreams()[i].getVideoTracks()), socketId);
                check = true;
            }
            break;
        }
    }

    if(!check) {
        if(!worker[socketId+"_"+streamId+"_video"])
            worker[socketId+"_"+streamId+"_video"] = { uid: socketId, streamId: streamId, count: 0 };
        else
            worker[socketId+"_"+streamId+"_video"].count++;
        if(worker[socketId+"_"+streamId+"_video"].count > 5) delete worker[socketId+"_"+streamId+"_video"];
    }else if(worker[socketId+"_"+streamId+"_video"]) delete worker[socketId+"_"+streamId+"_video"];
}

const sendPeerData = (message, uid) => {
    socket.emit('RTCData', message, uid);
}