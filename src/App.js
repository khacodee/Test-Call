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

  useEffect(() => {
    if (isLoggedIn) {
      // Thiết lập kết nối SignalR khi đã đăng nhập
      const newConnection = new signalR.HubConnectionBuilder()
        .withUrl(`${SERVER_URL}?userId=${userId}`)
        .withAutomaticReconnect()
        .build();

      newConnection.start().catch(err => console.error("SignalR Connection Error: ", err));

      // Xử lý sự kiện nhận tín hiệu từ server
      newConnection.on("ReceiveOffer", async (offer, callerUserId) => {
        setTargetUserId(callerUserId);
        await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(offer)));
        const answer = await peer.current.createAnswer();
        await peer.current.setLocalDescription(answer);
        newConnection.invoke("SendAnswer", callerUserId, JSON.stringify(answer));
      });

      newConnection.on("ReceiveAnswer", async (answer) => {
        await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(answer)));
      });

      newConnection.on("ReceiveIceCandidate", (candidate) => {
        peer.current.addIceCandidate(new RTCIceCandidate(JSON.parse(candidate)));
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

  const setupWebRTC = async () => {
  try {
    peer.current = new RTCPeerConnection({ iceServers: [{ urls: "stun:stun.l.google.com:19302" }] });

    peer.current.onicecandidate = event => {
      if (event.candidate) {
        connection.invoke("SendIceCandidate", targetUserId, JSON.stringify(event.candidate));
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
    await setupWebRTC();
    const offer = await peer.current.createOffer();
    await peer.current.setLocalDescription(offer);
    connection.invoke("SendOffer", targetUserId, JSON.stringify(offer));
  };

  const endCall = () => {
    if (peer.current) {
      peer.current.close();
      peer.current = null;
    }
    localVideoRef.current.srcObject = null;
    remoteVideoRef.current.srcObject = null;
  };

  const handleLogin = () => {
    setIsLoggedIn(true);
  };

  const acceptCall = () => {
    // Logic to accept the call
    console.log("Call accepted from:", incomingCall);
    setIncomingCall(null);
  };

  const rejectCall = () => {
    // Logic to reject the call
    console.log("Call rejected from:", incomingCall);
    setIncomingCall(null);
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

          {/* Incoming Call UI */}
          {incomingCall && (
            <div>
              <p>Incoming call from: {incomingCall}</p>
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