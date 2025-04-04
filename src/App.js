import React, { useEffect, useRef, useState } from "react";
import * as signalR from "@microsoft/signalr";

const SERVER_URL = "https://tellory.id.vn/callhub";

const App = () => {
  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peer = useRef(null);
  const [connection, setConnection] = useState(null);
  const [targetUserId, setTargetUserId] = useState("");
  const [userId, setUserId] = useState("");
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [incomingCall, setIncomingCall] = useState(null); // State for incoming call
  const iceCandidateQueue = useRef([]);
  const [isMicOn, setIsMicOn] = useState(true);
const [isVideoOn, setIsVideoOn] = useState(true);
  useEffect(() => {
    if (isLoggedIn) {
      // Thiết lập kết nối SignalR khi đã đăng nhập
      const newConnection = new signalR.HubConnectionBuilder()
        .withUrl(`${SERVER_URL}?userId=${userId}`)
        .withAutomaticReconnect()
        .build();

      newConnection.start().catch(err => console.error("SignalR Connection Error: ", err));
      newConnection.on("CallEnded", (callerUserId) => {
      console.log(`Call ended by user: ${callerUserId}`);
      endCall(); // Kết thúc cuộc gọi ở phía client
    });
      // Xử lý sự kiện nhận tín hiệu từ server
      newConnection.on("ReceiveOffer", async (offer, callerUserId) => {
  try {
    console.log("Received offer from:", callerUserId);

    // Set the incoming call state
    setIncomingCall({ callerUserId, offer });

    // Thiết lập targetUserId từ callerUserId
    setTargetUserId(callerUserId);

    // Prepare WebRTC connection immediately
    if (!peer.current) {
      await setupWebRTC();
    }
  } catch (error) {
    console.error("Error handling incoming offer:", error);
  }
});


      newConnection.on("ReceiveAnswer", async (answer) => {
        await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
      });

      

newConnection.on("ReceiveIceCandidate", (candidate) => {
  try {
    console.log("Nhận ICE candidate:", candidate);
    const iceCandidate = new RTCIceCandidate(JSON.parse(candidate));
    if (peer.current && peer.current.remoteDescription) {
      peer.current.addIceCandidate(iceCandidate);
    } else {
      console.warn("Remote description chưa được thiết lập. Đưa ICE candidate vào hàng đợi.");
      iceCandidateQueue.current.push(iceCandidate);
    }
  } catch (error) {
    console.error("Lỗi khi thêm ICE candidate:", error);
  }
});

      newConnection.on("CallEnded", () => {
        endCall();
      });

      // Handle incoming call
      newConnection.on("IncomingCall", (callerUserId) => {
        setIncomingCall(callerUserId);
      });

      setConnection(newConnection);
      return () => newConnection.stop();
    }
  }, [isLoggedIn, userId]);
const checkUserExists = async (userId) => {
  try {
    const userExists = await connection.invoke("CheckUserExists", userId);
    console.log(`User ${userId} exists: ${userExists}`);
    return userExists;
  } catch (error) {
    console.error("Error checking user existence:", error);
    return false;
  }
};
  const setupWebRTC = async () => {
  try {
    peer.current = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }, {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        }]
      });

   peer.current.onicecandidate = async (event) => {
  if (event.candidate && targetUserId) {
    console.log("Generated ICE candidate:", event.candidate);

    const userExists = await checkUserExists(targetUserId);
    if (!userExists) {
      console.warn(`Không thể gửi ICE candidate. User ${targetUserId} không kết nối.`);
      return;
    }

    console.log("Gửi ICE candidate đến:", targetUserId);
    connection.invoke("SendIceCandidate", targetUserId, JSON.stringify(event.candidate))
      .catch(err => console.error("Lỗi khi gửi ICE candidate:", err));
  } else {
    console.warn("ICE candidate không được gửi: targetUserId chưa được thiết lập.");
  }
};


    peer.current.ontrack = event => {
      remoteVideoRef.current.srcObject = event.streams[0];
    };

    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    stream.getTracks().forEach(track => peer.current.addTrack(track, stream));
    localVideoRef.current.srcObject = stream;
  } catch (error) {
    console.error("Error accessing media devices:", error);
    // Display an error message to the user
    alert("Unable to access camera/microphone: " + error.message);
  }
};

const startCall = async () => {
  try {
    if (!targetUserId) {
      alert("Vui lòng nhập ID người dùng mục tiêu.");
      return;
    }
      const userExists = await checkUserExists(targetUserId);
    if (!userExists) {
      alert(`Người dùng với ID ${targetUserId} không tồn tại hoặc không trực tuyến.`);
      return;
    }
    // Thiết lập kết nối WebRTC
    await setupWebRTC();

    // Tạo offer và thiết lập local description
    const offer = await peer.current.createOffer();
    await peer.current.setLocalDescription(offer);

    // Gửi offer đến người dùng mục tiêu
    connection.invoke("SendOffer", targetUserId, JSON.stringify(offer))
      .catch(err => console.error("Lỗi khi gửi offer:", err));
  } catch (error) {
    console.error("Lỗi khi bắt đầu cuộc gọi:", error);
    alert("Không thể bắt đầu cuộc gọi. Vui lòng thử lại.");
  }
};

  const endCall = () => {
    if (peer.current) {
      peer.current.close();
      peer.current = null;
    }
    localVideoRef.current.srcObject = null;
    remoteVideoRef.current.srcObject = null;
    if (connection && targetUserId) {
    connection.invoke("EndCall", targetUserId)
      .catch(err => console.error("Lỗi khi gửi thông báo kết thúc cuộc gọi:", err));
  }
  };

  const handleLogin = () => {
    setIsLoggedIn(true);
  };
const acceptCall = async () => {
  try {
    console.log("Chấp nhận cuộc gọi từ:", incomingCall);

    // Thiết lập targetUserId
    setTargetUserId(incomingCall.callerUserId);

    // Thiết lập kết nối WebRTC
    await setupWebRTC();

    // Thiết lập remote description với offer nhận được
    await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(incomingCall.offer)));

    // Xử lý các ICE candidate trong hàng đợi
    while (iceCandidateQueue.current.length > 0) {
      const candidate = iceCandidateQueue.current.shift();
      await peer.current.addIceCandidate(candidate);
    }

    // Tạo answer và thiết lập local description
    const answer = await peer.current.createAnswer();
    await peer.current.setLocalDescription(answer);

    // Gửi answer lại cho người gọi
    connection.invoke("SendAnswer", incomingCall.callerUserId, JSON.stringify(answer));

    // Xóa thông báo cuộc gọi đến
    setIncomingCall(null);
  } catch (error) {
    console.error("Lỗi khi chấp nhận cuộc gọi:", error);
    alert("Không thể chấp nhận cuộc gọi. Vui lòng thử lại.");
  }
};


  const rejectCall = () => {
    // Logic to reject the call
    console.log("Call rejected from:", incomingCall);
    setIncomingCall(null);
  };
const toggleMic = () => {
  if (localVideoRef.current && localVideoRef.current.srcObject) {
    const audioTracks = localVideoRef.current.srcObject.getAudioTracks();
    if (audioTracks.length > 0) {
      const isEnabled = audioTracks[0].enabled;
      audioTracks[0].enabled = !isEnabled;
      setIsMicOn(!isEnabled);
    }
  }
};

const toggleVideo = () => {
  if (localVideoRef.current && localVideoRef.current.srcObject) {
    const videoTracks = localVideoRef.current.srcObject.getVideoTracks();
    if (videoTracks.length > 0) {
      const isEnabled = videoTracks[0].enabled;
      videoTracks[0].enabled = !isEnabled;
      setIsVideoOn(!isEnabled);
    }
  }
};
  return (
    <div>
      {!isLoggedIn ? (
        <div>
          <h2>Login</h2>
          <input
            type="text"
            placeholder="Enter User ID"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
          />
          <button onClick={handleLogin}>Login</button>
        </div>
      ) : (
        <div>
  <h1>Video Call</h1>
  <video ref={localVideoRef} autoPlay playsInline muted style={{ width: "300px" }} />
  <video ref={remoteVideoRef} autoPlay playsInline style={{ width: "300px" }} />
  <input type="text" placeholder="Target User ID" onChange={(e) => setTargetUserId(e.target.value)} />
  <button onClick={startCall}>Gọi</button>
  <button onClick={endCall}>Kết thúc</button>
  <button onClick={toggleMic}>{isMicOn ? "Tắt mic" : "Bật mic"}</button>
  <button onClick={toggleVideo}>{isVideoOn ? "Tắt video" : "Bật video"}</button>

  {/* Incoming Call UI */}
  {incomingCall && (
    <div>
      <p>Incoming call from: {incomingCall.callerUserId}</p>
      <button onClick={acceptCall}>Accept</button>
      <button onClick={rejectCall}>Reject</button>
    </div>
  )}
</div>
      )}
    </div>
  );
};

export default App;