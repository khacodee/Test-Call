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
  try {
    console.log("Received offer from:", callerUserId);

    // Set the incoming call state
    setIncomingCall({ callerUserId, offer });

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
    const iceCandidate = new RTCIceCandidate(JSON.parse(candidate));
    if (peer.current && peer.current.remoteDescription) {
      peer.current.addIceCandidate(iceCandidate);
    } else {
      console.warn("Remote description not set. Queuing ICE candidate.");
      iceCandidateQueue.current.push(iceCandidate);
    }
  } catch (error) {
    console.error("Error adding ICE candidate:", error);
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

  const setupWebRTC = async () => {
  try {
    peer.current = new RTCPeerConnection({
        iceServers: [{ urls: "stun:stun.l.google.com:19302" }, {
          urls: "turn:openrelay.metered.ca:80",
          username: "openrelayproject",
          credential: "openrelayproject"
        }]
      });

    peer.current.onicecandidate = event => {
  if (event.candidate && targetUserId) {
    console.log("Sending ICE candidate to:", targetUserId);
    connection.invoke("SendIceCandidate", targetUserId, JSON.stringify(event.candidate))
      .catch(err => console.error("Error sending ICE candidate:", err));
  } else {
    console.warn("ICE candidate not sent: targetUserId is not set.");
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
    setTargetUserId(targetUserId); // Ensure targetUserId is set
    await setupWebRTC();
    const offer = await peer.current.createOffer();
    await peer.current.setLocalDescription(offer);
    connection.invoke("SendOffer", targetUserId, JSON.stringify(offer));
  } catch (error) {
    console.error("Error starting call:", error);
    alert("Failed to start the call. Please try again.");
  }
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
const acceptCall = async () => {
  try {
    console.log("Call accepted from:", incomingCall);

    // Set the targetUserId to the caller's ID
    setTargetUserId(incomingCall.callerUserId);

    // Set up WebRTC connection
    await setupWebRTC();

    // Set the remote description with the offer received from the caller
    await peer.current.setRemoteDescription(new RTCSessionDescription(JSON.parse(incomingCall.offer)));

    // Process queued ICE candidates
    while (iceCandidateQueue.current.length > 0) {
      const candidate = iceCandidateQueue.current.shift();
      await peer.current.addIceCandidate(candidate);
    }

    // Create an answer and set it as the local description
    const answer = await peer.current.createAnswer();
    await peer.current.setLocalDescription(answer);

    // Send the answer back to the caller
    connection.invoke("SendAnswer", incomingCall.callerUserId, JSON.stringify(answer));

    // Clear the incoming call notification
    setIncomingCall(null);
  } catch (error) {
    console.error("Error accepting call:", error);
    alert("Failed to accept the call. Please try again.");
  }
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